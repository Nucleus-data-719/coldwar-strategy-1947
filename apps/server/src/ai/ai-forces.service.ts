import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
  UNITS,
  aiPatrolWorthKeeping,
  aiPurchases,
  canAfford,
  hasPort,
  hopsFrom,
  minelayerCount,
  planAiFleetTarget,
  planAiPatrol,
  portNodes,
  seaNeighbors,
  spend,
  unitPower,
  type Resources,
  type StackUnit,
  type UnitType,
} from '@cw/shared';
import type { DbOrTx } from '../db/db.module';
import { buildings, formationUnits, formations, provinces, seaMines, type CountryRow } from '../db/schema';
import { addToGarrison } from '../military/garrison';
import { MovementService } from '../military/movement.service';
import { NavalService, currentNode } from '../military/naval.service';
import { EconomyService } from '../economy/economy.service';
import { WarsService } from '../wars/wars.service';

/** Money the AI keeps in hand when buying aircraft and ships. */
const RESERVE_MONEY = 600;
const MAX_FLEET_ORDERS = 3;
const MAX_AIR_ORDERS = 3;
const STATION_HOPS = 2;

/**
 * The AI's air force and navy. While at war it buys a few aircraft and ships (paying full price, ignoring research),
 * sends aircraft to patrol over the biggest enemy armies in reach, hunts enemy fleets it can see and clearly outguns,
 * and lays mine fields just off its own harbours. The decisions are made by the pure planners in the shared package.
 */
@Injectable()
export class AiForcesService {
  private readonly log = new Logger(AiForcesService.name);

  constructor(
    private readonly wars: WarsService,
    private readonly movement: MovementService,
    private readonly naval: NavalService,
    private readonly economy: EconomyService,
  ) {}

  async act(tx: DbOrTx, country: CountryRow, balance: Resources): Promise<{ balance: Resources; acted: boolean }> {
    const enemies = await this.wars.enemiesOf(tx, country.id);
    if (enemies.size === 0) return { balance, acted: false };
    let acted = false;

    // only id, key and owner: the full rows (production, terrain, names) are many times larger
    const provs = await tx.select({ id: provinces.id, key: provinces.key, ownerCountryId: provinces.ownerCountryId }).from(provinces).where(eq(provinces.campaignId, country.campaignId));
    const keyById = new Map(provs.map((p) => [p.id, p.key]));
    const idByKey = new Map(provs.map((p) => [p.key, p.id]));
    const owned = provs.filter((p) => p.ownerCountryId === country.id);
    const enemyProvinceKeys = new Set(provs.filter((p) => enemies.has(p.ownerCountryId)).map((p) => p.key));

    // this country's armies and its enemies' (not every army in the world)
    const forms = await tx.select().from(formations).where(and(eq(formations.campaignId, country.campaignId), inArray(formations.countryId, [country.id, ...enemies])));
    const unitRows = forms.length ? await tx.select().from(formationUnits).where(inArray(formationUnits.formationId, forms.map((f) => f.id))) : [];
    const unitsOf = (id: string): StackUnit[] => unitRows.filter((u) => u.formationId === id).map((u) => ({ unitType: u.unitType, count: u.count }));
    const mine = forms.filter((f) => f.countryId === country.id);

    // ---------- shopping ----------
    const specials = owned.length
      ? await tx
          .select({ provinceId: buildings.provinceId, type: buildings.type })
          .from(buildings)
          .where(and(inArray(buildings.provinceId, owned.map((p) => p.id)), eq(buildings.status, 'complete')))
      : [];
    const airbaseProvince = specials.find((b) => b.type === 'airbase')?.provinceId;
    const harborProvince = specials.find((b) => b.type === 'harbor')?.provinceId;
    const count = (cat: 'air' | 'naval') => mine.reduce((s, f) => s + unitsOf(f.id).filter((u) => UNITS[u.unitType].category === cat).reduce((n, u) => n + u.count, 0), 0);
    for (const buy of aiPurchases({
      atWar: true,
      ownedProvinces: owned.length,
      hasAirbase: !!airbaseProvince,
      hasHarbor: !!harborProvince,
      aircraft: count('air'),
      ships: count('naval'),
    })) {
      const def = UNITS[buy.unitType];
      const cost = def.cost as Partial<Resources>;
      const total: Partial<Resources> = {};
      for (const [k, v] of Object.entries(cost)) total[k as keyof Resources] = (v ?? 0) * buy.count;
      if (!canAfford(balance, total) || balance.money - (total.money ?? 0) < RESERVE_MONEY) continue;
      const where = def.category === 'air' ? airbaseProvince : harborProvince;
      if (!where) continue;
      balance = spend(balance, total);
      await addToGarrison(tx, { campaignId: country.campaignId, countryId: country.id, provinceId: where, unitType: buy.unitType, count: buy.count });
      acted = true;
    }
    await this.economy.writeBalance(tx, country.id, balance);

    // ---------- air patrols ----------
    const enemyPower = new Map<string, number>();
    for (const f of forms) {
      if (!enemies.has(f.countryId) || f.seaNode !== null || f.moveArrivesAt) continue;
      const key = keyById.get(f.provinceId);
      const land = unitsOf(f.id).filter((u) => UNITS[u.unitType].category === 'land');
      if (key && land.length) enemyPower.set(key, (enemyPower.get(key) ?? 0) + unitPower(land));
    }
    let airOrders = 0;
    for (const f of mine) {
      if (f.seaNode !== null) continue;
      const air = unitsOf(f.id).filter((u) => UNITS[u.unitType].category === 'air' && u.count > 0);
      if (air.length === 0) continue;
      const here = keyById.get(f.provinceId);
      if (!here) continue;
      try {
        if (f.patrolActive) {
          if (!aiPatrolWorthKeeping(here, air, enemyPower)) {
            await tx.update(formations).set({ patrolActive: false, patrolSince: null, patrolSettledAt: null }).where(eq(formations.id, f.id));
            acted = true;
          }
          continue;
        }
        if (f.moveArrivesAt || airOrders >= MAX_AIR_ORDERS) continue;
        const plan = planAiPatrol({ baseKey: here, units: air, enemyPower, enemyProvinces: enemyProvinceKeys });
        if (!plan) continue;
        const all = unitsOf(f.id);
        const onlyAir = all.every((u) => UNITS[u.unitType].category === 'air');
        const send = onlyAir ? undefined : (Object.fromEntries(air.map((u) => [u.unitType, u.count])) as Partial<Record<UnitType, number>>);
        await this.movement.orderPatrolFor(tx, country, country.campaignId, f.id, idByKey.get(plan.centerKey)!, send);
        airOrders++;
        acted = true;
      } catch (err) {
        this.log.debug(`AI patrol skipped: ${(err as Error).message}`);
      }
    }

    // ---------- navy ----------
    const view = await this.naval.seaView(tx, country.campaignId, country.id, keyById);
    const ownMines = await tx.select().from(seaMines).where(and(eq(seaMines.campaignId, country.campaignId), eq(seaMines.countryId, country.id)));
    const mined = new Set(ownMines.map((m) => m.node));
    const fresh = await tx.select().from(formations).where(and(eq(formations.campaignId, country.campaignId), eq(formations.countryId, country.id)));
    let fleetOrders = 0;
    for (const f of fresh) {
      if (fleetOrders >= MAX_FLEET_ORDERS) break;
      if (f.seaArrivesAt || f.moveArrivesAt || f.patrolActive) continue;
      const all = unitsOf(f.id);
      const ships = all.filter((u) => UNITS[u.unitType].category === 'naval' && u.count > 0);
      if (ships.length === 0) continue;
      const onlyShips = all.every((u) => UNITS[u.unitType].category === 'naval');
      const send = onlyShips ? undefined : (Object.fromEntries(ships.map((u) => [u.unitType, u.count])) as Partial<Record<UnitType, number>>);
      try {
        const myNode = f.seaNode !== null ? currentNode(f) : (portNodes(keyById.get(f.provinceId) ?? '')[0] ?? -1);
        const near = myNode >= 0 ? hopsFrom([myNode], 8) : new Map<number, number>();
        const seen = view.enemies
          .map((e) => ({ id: e.id, node: e.node, units: unitsOf(e.id), distance: near.get(e.node) ?? 99 }))
          .filter((e) => e.distance <= 8 && e.units.length > 0);
        const targetId = planAiFleetTarget(ships, seen);
        if (targetId) {
          await this.naval.attackFor(tx, country, country.campaignId, f.id, targetId, send);
          fleetOrders++;
          acted = true;
          continue;
        }
        const layers = minelayerCount(ships);
        if (f.seaNode !== null) {
          if (layers > 0 && !mined.has(currentNode(f))) {
            await this.naval.layMinesFor(tx, country, country.campaignId, f.id);
            mined.add(currentNode(f));
          } else {
            const home = owned.find((p) => hasPort(p.key));
            if (home) await this.naval.sailFor(tx, country, country.campaignId, f.id, { toProvinceId: home.id });
          }
          fleetOrders++;
          acted = true;
        } else if (layers > 0 && mined.size < 3 && myNode >= 0) {
          // Sail to a dot two steps off our own harbour, upgrading to a mine field when we get there.
          const ring = [...hopsFrom([myNode], STATION_HOPS)].filter(([, d]) => d === STATION_HOPS).map(([n]) => n).filter((n) => !mined.has(n) && seaNeighbors(n).length > 0);
          if (ring.length) {
            await this.naval.sailFor(tx, country, country.campaignId, f.id, { toNode: ring[0] }, send);
            fleetOrders++;
            acted = true;
          }
        }
      } catch (err) {
        this.log.debug(`AI fleet order skipped: ${(err as Error).message}`);
      }
    }
    return { balance, acted };
  }
}
