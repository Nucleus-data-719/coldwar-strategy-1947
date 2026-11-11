import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, lt, lte, gt } from 'drizzle-orm';
import {
  BUILDINGS,
  BUILDING_KNOCKED_OUT,
  BUILDING_REPAIR_PER_HOUR,
  PATROL_MAX_STEPS,
  PATROL_STEP_HOURS,
  PROVINCE_BY_KEY,
  UNITS,
  hashSeed,
  lossCount,
  overHours,
  patrolHour,
  patrolRadius,
  provincesInCircle,
  type UnitType,
} from '@cw/shared';
import { env } from '../config/env';
import { DB, Db } from '../db/db.module';
import { buildings, formationUnits, formations, FormationRow, FormationUnitRow, NotificationRow, provinces } from '../db/schema';
import { EconomyService } from '../economy/economy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WarsService } from '../wars/wars.service';

const STEP_MS = () => (PATROL_STEP_HOURS * 3600 * 1000) / env.GAME_SPEED;

/**
 * Air patrols. Every game hour (scaled by GAME_SPEED) each patrol hurts the enemy armies and buildings
 * inside its circle, and the aircraft take losses from air defence and dogfights. Progress is stored as
 * `patrolSettledAt`, so nothing is lost while the server is off or nobody is watching.
 */
@Injectable()
export class PatrolService {
  private readonly log = new Logger(PatrolService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly economy: EconomyService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly wars: WarsService,
  ) {}

  /** Scheduler hook. */
  async processDue(): Promise<void> {
    const due = await this.db
      .select({ id: formations.id, countryId: formations.countryId, campaignId: formations.campaignId })
      .from(formations)
      .where(and(eq(formations.patrolActive, true), lte(formations.patrolSettledAt, new Date(Date.now() - STEP_MS()))))
      .limit(100);
    for (const d of due) {
      try {
        await this.settle(d.id, d.countryId, d.campaignId);
      } catch (err) {
        this.log.warn(`patrol ${d.id}: ${(err as Error).message}`);
      }
    }
    await this.repairBuildings();
  }

  private async settle(formationId: string, countryId: string, campaignId: string): Promise<void> {
    // Work out which enemy countries are inside the circle so they can be locked together with the patrol's owner.
    const [f0] = await this.db.select().from(formations).where(eq(formations.id, formationId));
    if (!f0 || !f0.patrolActive) return;
    const rows = await this.db.select({ id: provinces.id, key: provinces.key, owner: provinces.ownerCountryId }).from(provinces).where(eq(provinces.campaignId, campaignId));
    const keyById = new Map(rows.map((r) => [r.id, r.key]));
    const centreKey = keyById.get(f0.provinceId);
    if (!centreKey) return;
    const enemies = await this.wars.enemiesOf(this.db, countryId);
    const own0 = await this.db.select().from(formationUnits).where(eq(formationUnits.formationId, f0.id));
    const circle = new Set(provincesInCircle(centreKey, patrolRadius(own0)));
    const circleRows = rows.filter((r) => circle.has(r.key));
    const toLock = new Set<string>([countryId]);
    for (const r of circleRows) if (enemies.has(r.owner)) toLock.add(r.owner);
    const circleIds = circleRows.map((r) => r.id);
    if (circleIds.length && enemies.size) {
      const there = await this.db
        .select({ countryId: formations.countryId })
        .from(formations)
        .where(and(inArray(formations.provinceId, circleIds), inArray(formations.countryId, [...enemies])));
      for (const t of there) toLock.add(t.countryId);
    }

    const notes: NotificationRow[] = [];
    await this.economy.lockMany([...toLock], async (tx, locked) => {
      const [f] = await tx.select().from(formations).where(eq(formations.id, formationId)).for('update');
      if (!f || !f.patrolActive || !f.patrolSettledAt) return;
      const stepMs = STEP_MS();
      const steps = Math.min(PATROL_MAX_STEPS, Math.floor((Date.now() - f.patrolSettledAt.getTime()) / stepMs));
      if (steps < 1) return;
      const settledAt = f.patrolSettledAt.getTime();
      const hours = steps * PATROL_STEP_HOURS;
      const seedBase = `${f.id}:${settledAt}`;

      const myUnits = await tx.select().from(formationUnits).where(eq(formationUnits.formationId, f.id));
      const radius = patrolRadius(myUnits);
      const here = new Set(provincesInCircle(centreKey, radius));
      const inCircle = rows.filter((r) => here.has(r.key));
      const ids = inCircle.map((r) => r.id);
      const enemyProvinces = inCircle.filter((r) => enemies.has(r.owner));

      // Enemy forces standing in the circle (armies of countries at war with the patrol's owner, wherever they stand).
      const enemyForms: { f: FormationRow; units: FormationUnitRow[] }[] = [];
      if (ids.length && enemies.size) {
        const fr = await tx
          .select()
          .from(formations)
          .where(and(inArray(formations.provinceId, ids), inArray(formations.countryId, [...enemies]), isNull(formations.moveArrivesAt), isNull(formations.seaNode)));
        for (const e of fr) enemyForms.push({ f: e, units: await tx.select().from(formationUnits).where(eq(formationUnits.formationId, e.id)) });
      }
      const isAir = (t: UnitType) => UNITS[t].category === 'air';
      const enemyGround = enemyForms.reduce((s, e) => s + e.units.filter((u) => !isAir(u.unitType)).reduce((a, u) => a + u.count, 0), 0);
      const enemyAirUnits = enemyForms.flatMap((e) => e.units.filter((u) => isAir(u.unitType)));
      const enemyAirPower = enemyAirUnits.reduce((s, u) => s + u.count * UNITS[u.unitType].attack * (u.unitType === 'fighter' ? 1 : 0.4), 0);
      const bld = enemyProvinces.length
        ? await tx
            .select()
            .from(buildings)
            .where(and(inArray(buildings.provinceId, enemyProvinces.map((p) => p.id)), eq(buildings.status, 'complete')))
        : [];

      const h = patrolHour(myUnits, { enemyGroundUnits: enemyGround, enemyArmies: enemyForms.length, enemyProvinces: enemyProvinces.length, enemyAirPower, enemyBuildings: bld.length });

      // 1. Enemy armies and aircraft.
      for (const e of enemyForms) {
        let remaining = 0;
        for (const u of e.units) {
          const pct = overHours(isAir(u.unitType) ? h.enemyAirLossPct : h.groundLossPct, hours);
          const lost = pct > 0 ? lossCount(u.count, pct, hashSeed(`${seedBase}:${u.id}`)) : 0;
          if (lost <= 0) { remaining += u.count; continue; }
          if (lost >= u.count) await tx.delete(formationUnits).where(eq(formationUnits.id, u.id));
          else { await tx.update(formationUnits).set({ count: u.count - lost }).where(eq(formationUnits.id, u.id)); remaining += u.count - lost; }
        }
        if (remaining === 0) await tx.delete(formations).where(eq(formations.id, e.f.id));
      }

      // 2. Enemy buildings. Settle the owner first: damage changes what the province produces.
      const points = h.buildingPoints * hours;
      if (points > 0) {
        const ownerOf = new Map(inCircle.map((r) => [r.id, r.owner]));
        const settledOwners = new Set<string>();
        for (const b of bld) {
          const add = Math.floor(points) + ((hashSeed(`${seedBase}:${b.id}`) % 10000) / 10000 < points - Math.floor(points) ? 1 : 0);
          if (add <= 0) continue;
          const owner = locked.get(ownerOf.get(b.provinceId)!);
          if (owner && !settledOwners.has(owner.id)) { await this.economy.settle(tx, owner); settledOwners.add(owner.id); }
          const damage = Math.min(100, b.damage + add);
          if (damage >= 100) {
            await tx.delete(buildings).where(eq(buildings.id, b.id));
            if (owner) {
              notes.push(await this.notifications.add(tx, { campaignId, countryId: owner.id, type: 'building_destroyed', message: `${BUILDINGS[b.type].name} in ${PROVINCE_BY_KEY[keyById.get(b.provinceId)!]?.name ?? 'a province'} was destroyed by air raids.` }));
            }
          } else {
            await tx.update(buildings).set({ damage, damageUpdatedAt: new Date() }).where(eq(buildings.id, b.id));
            if (owner && b.damage < BUILDING_KNOCKED_OUT && damage >= BUILDING_KNOCKED_OUT) {
              notes.push(await this.notifications.add(tx, { campaignId, countryId: owner.id, type: 'building_damaged', message: `${BUILDINGS[b.type].name} in ${PROVINCE_BY_KEY[keyById.get(b.provinceId)!]?.name ?? 'a province'} is knocked out by air raids until it is repaired.` }));
            }
          }
        }
      }

      // 3. The patrolling aircraft: air defence and dogfights.
      let left = 0;
      for (const u of myUnits) {
        const lost = lossCount(u.count, overHours(h.ownLossPct, hours), hashSeed(`${seedBase}:own:${u.id}`));
        if (lost >= u.count) await tx.delete(formationUnits).where(eq(formationUnits.id, u.id));
        else { if (lost > 0) await tx.update(formationUnits).set({ count: u.count - lost }).where(eq(formationUnits.id, u.id)); left += u.count - lost; }
      }
      if (left === 0) {
        await tx.delete(formations).where(eq(formations.id, f.id));
        notes.push(await this.notifications.add(tx, { campaignId, countryId, type: 'patrol_lost', message: `${f.name} was shot down over ${PROVINCE_BY_KEY[centreKey]?.name ?? 'its patrol area'}.` }));
      } else {
        await tx.update(formations).set({ patrolSettledAt: new Date(settledAt + steps * stepMs) }).where(eq(formations.id, f.id));
      }
    });
    for (const n of notes) this.notifications.publish(n);
    this.realtime.campaignUpdate(campaignId, { kind: 'army' });
  }

  /** Bombed buildings repair one point per game hour once they have been left alone. */
  private async repairBuildings(): Promise<void> {
    const stepMs = STEP_MS();
    const due = await this.db
      .select({ id: buildings.id, provinceId: buildings.provinceId, damage: buildings.damage, campaignId: buildings.campaignId })
      .from(buildings)
      .where(and(gt(buildings.damage, 0), lt(buildings.damageUpdatedAt, new Date(Date.now() - stepMs))))
      .limit(200);
    for (const d of due) {
      try {
        const [p] = await this.db.select({ owner: provinces.ownerCountryId }).from(provinces).where(eq(provinces.id, d.provinceId));
        if (!p) continue;
        await this.economy.lock(p.owner, async (tx, country) => {
          const [b] = await tx.select().from(buildings).where(eq(buildings.id, d.id)).for('update');
          if (!b || b.damage <= 0 || !b.damageUpdatedAt) return;
          const steps = Math.floor((Date.now() - b.damageUpdatedAt.getTime()) / stepMs);
          if (steps < 1) return;
          const damage = Math.max(0, b.damage - steps * BUILDING_REPAIR_PER_HOUR);
          // Settle before the building starts working again.
          if (b.damage >= BUILDING_KNOCKED_OUT && damage < BUILDING_KNOCKED_OUT) await this.economy.settle(tx, country);
          await tx.update(buildings).set({ damage, damageUpdatedAt: new Date(b.damageUpdatedAt.getTime() + steps * stepMs) }).where(eq(buildings.id, b.id));
        });
      } catch (err) {
        this.log.warn(`repair ${d.id}: ${(err as Error).message}`);
      }
    }
  }
}
