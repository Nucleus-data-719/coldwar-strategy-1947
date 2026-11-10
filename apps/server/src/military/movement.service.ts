import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import {
  PROVINCE_BY_KEY,
  UNITS,
  advanceMovement,
  formationSpeed,
  planRoute,
  type UnitType,
} from '@cw/shared';
import { env } from '../config/env';
import { DB, Db, DbOrTx } from '../db/db.module';
import { buildings, formationUnits, formations, FormationRow, FormationUnitRow, NotificationRow, provinces } from '../db/schema';
import { EconomyService } from '../economy/economy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlayersService } from '../players/players.service';
import { RealtimeService } from '../realtime/realtime.service';

interface MapContext {
  keyById: Map<string, string>;
  idByKey: Map<string, string>;
  ownerByKey: Map<string, string>;
  railwayKeys: Set<string>;
}

/**
 * Army movement. An order stores where the army is heading and when the current leg ends.
 * The scheduler applies finished legs, so armies keep marching while players are offline.
 */
@Injectable()
export class MovementService {
  private readonly log = new Logger(MovementService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly economy: EconomyService,
    private readonly players: PlayersService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  private async loadContext(tx: DbOrTx, campaignId: string): Promise<MapContext> {
    const rows = await tx
      .select({ id: provinces.id, key: provinces.key, owner: provinces.ownerCountryId })
      .from(provinces)
      .where(eq(provinces.campaignId, campaignId));
    const keyById = new Map(rows.map((r) => [r.id, r.key]));
    const idByKey = new Map(rows.map((r) => [r.key, r.id]));
    const ownerByKey = new Map(rows.map((r) => [r.key, r.owner]));
    const rails = await tx
      .select({ provinceId: buildings.provinceId })
      .from(buildings)
      .where(and(eq(buildings.campaignId, campaignId), eq(buildings.type, 'railway'), eq(buildings.status, 'complete')));
    const railwayKeys = new Set(rails.map((r) => keyById.get(r.provinceId)).filter((k): k is string => !!k));
    return { keyById, idByKey, ownerByKey, railwayKeys };
  }

  /** Splits the chosen units off into a new formation in the same province. Returns the formation to move. */
  private async split(
    tx: DbOrTx,
    formation: FormationRow,
    units: FormationUnitRow[],
    send: Partial<Record<UnitType, number>>,
  ): Promise<{ target: FormationRow; units: { unitType: UnitType; count: number }[] }> {
    const chosen: { unitType: UnitType; count: number }[] = [];
    for (const [type, raw] of Object.entries(send)) {
      const count = raw ?? 0;
      if (count <= 0) continue;
      const have = units.find((u) => u.unitType === type);
      if (!have || have.count < count) {
        throw new BadRequestException(`Not enough ${UNITS[type as UnitType]?.name ?? type} in this army`);
      }
      chosen.push({ unitType: type as UnitType, count });
    }
    if (chosen.length === 0) throw new BadRequestException('Choose at least one unit to send');

    const whole = units.every((u) => (chosen.find((c) => c.unitType === u.unitType)?.count ?? 0) === u.count);
    if (whole) return { target: formation, units };

    const existing = await tx.select({ id: formations.id }).from(formations).where(eq(formations.countryId, formation.countryId));
    const [fresh] = await tx
      .insert(formations)
      .values({
        campaignId: formation.campaignId,
        countryId: formation.countryId,
        provinceId: formation.provinceId,
        name: `Task Force ${existing.length + 1}`,
      })
      .returning();

    for (const c of chosen) {
      const have = units.find((u) => u.unitType === c.unitType)!;
      if (have.count === c.count) {
        await tx.delete(formationUnits).where(eq(formationUnits.id, have.id));
      } else {
        await tx.update(formationUnits).set({ count: have.count - c.count }).where(eq(formationUnits.id, have.id));
      }
    }
    await tx.insert(formationUnits).values(chosen.map((c) => ({ formationId: fresh.id, unitType: c.unitType, count: c.count })));
    return { target: fresh, units: chosen };
  }

  /**
   * Player command: send an army to a province. With `send`, only those units go, as a new
   * task force. An army that is already moving finishes its current leg, then follows the new route.
   */
  async order(
    userId: string,
    campaignId: string,
    formationId: string,
    destinationProvinceId: string,
    send?: Partial<Record<UnitType, number>>,
  ) {
    const player = await this.players.require(userId, campaignId);

    const result = await this.economy.lock(player.countryId, async (tx, country) => {
      const [formation] = await tx
        .select()
        .from(formations)
        .where(and(eq(formations.id, formationId), eq(formations.campaignId, campaignId)))
        .for('update');
      if (!formation || formation.countryId !== country.id) throw new NotFoundException('Army not found');

      const ctx = await this.loadContext(tx, campaignId);
      const destKey = ctx.keyById.get(destinationProvinceId);
      if (!destKey) throw new NotFoundException('Province not found');

      const moving = !!formation.moveArrivesAt && !!formation.moveNextProvinceId;
      let target: FormationRow = formation;
      const unitRows = await tx.select().from(formationUnits).where(eq(formationUnits.formationId, formation.id));
      let units: { unitType: UnitType; count: number }[] = unitRows;

      if (send && Object.keys(send).length > 0) {
        if (moving) throw new BadRequestException('An army that is already moving cannot be split');
        ({ target, units } = await this.split(tx, formation, unitRows, send));
      }

      const speed = formationSpeed(units);
      if (speed <= 0) throw new BadRequestException('This army has no units');

      const startId = moving ? target.moveNextProvinceId! : target.provinceId;
      const startKey = ctx.keyById.get(startId)!;
      if (!moving && startKey === destKey) throw new BadRequestException('The army is already in that province');

      const route = planRoute(startKey, destKey, {
        countryId: country.id,
        ownerByKey: ctx.ownerByKey,
        railwayKeys: ctx.railwayKeys,
        speed,
        gameSpeed: env.GAME_SPEED,
      });
      if (!route) {
        throw new BadRequestException(
          'No route. For now armies can only travel through your own provinces; combat arrives with the next update.',
        );
      }

      const ids = route.path.map((k) => ctx.idByKey.get(k)!);
      if (moving) {
        await tx.update(formations).set({ movePath: ids.slice(1) }).where(eq(formations.id, target.id));
      } else {
        const now = new Date();
        await tx
          .update(formations)
          .set({
            moveNextProvinceId: ids[1],
            movePath: ids.slice(2),
            moveStartedAt: now,
            moveArrivesAt: new Date(now.getTime() + route.legSeconds[0] * 1000),
          })
          .where(eq(formations.id, target.id));
      }
      return { formationId: target.id, etaSeconds: route.totalSeconds };
    });

    this.realtime.campaignUpdate(campaignId, { kind: 'move' });
    return { ok: true, ...result };
  }

  /** Player command: halt after the current leg. */
  async stop(userId: string, campaignId: string, formationId: string) {
    const player = await this.players.require(userId, campaignId);
    await this.economy.lock(player.countryId, async (tx, country) => {
      const [formation] = await tx
        .select()
        .from(formations)
        .where(and(eq(formations.id, formationId), eq(formations.campaignId, campaignId)))
        .for('update');
      if (!formation || formation.countryId !== country.id) throw new NotFoundException('Army not found');
      if (!formation.moveArrivesAt) throw new BadRequestException('That army is not moving');
      await tx.update(formations).set({ movePath: [] }).where(eq(formations.id, formation.id));
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'move' });
    return { ok: true };
  }

  /** Scheduler hook: applies every leg whose arrival time has passed. */
  async processDue(): Promise<void> {
    const due = await this.db
      .select({ id: formations.id, countryId: formations.countryId, campaignId: formations.campaignId })
      .from(formations)
      .where(and(isNotNull(formations.moveArrivesAt), lte(formations.moveArrivesAt, new Date())))
      .limit(200);

    for (const d of due) {
      try {
        const notes = await this.economy.lock(d.countryId, (tx, country) => this.advance(tx, country.id, d.id));
        for (const n of notes) this.notifications.publish(n);
        this.realtime.campaignUpdate(d.campaignId, { kind: 'move' });
      } catch (err) {
        this.log.warn(`movement ${d.id}: ${(err as Error).message}`);
      }
    }
  }

  private async advance(tx: DbOrTx, countryId: string, formationId: string): Promise<NotificationRow[]> {
    const [f] = await tx.select().from(formations).where(eq(formations.id, formationId)).for('update');
    if (!f || !f.moveArrivesAt || !f.moveNextProvinceId || f.moveArrivesAt.getTime() > Date.now()) return [];

    const ctx = await this.loadContext(tx, f.campaignId);
    const units = await tx
      .select({ unitType: formationUnits.unitType, count: formationUnits.count })
      .from(formationUnits)
      .where(eq(formationUnits.formationId, f.id));

    const result = advanceMovement({
      locationKey: ctx.keyById.get(f.provinceId)!,
      nextKey: ctx.keyById.get(f.moveNextProvinceId)!,
      remainingKeys: f.movePath.map((id) => ctx.keyById.get(id)!).filter(Boolean),
      legArrivesAt: f.moveArrivesAt.getTime(),
      now: Date.now(),
      speed: formationSpeed(units),
      gameSpeed: env.GAME_SPEED,
      countryId,
      ownerByKey: ctx.ownerByKey,
      railwayKeys: ctx.railwayKeys,
    });

    const clear = { moveNextProvinceId: null, movePath: [] as string[], moveStartedAt: null, moveArrivesAt: null };
    const location = ctx.idByKey.get(result.locationKey)!;
    const place = PROVINCE_BY_KEY[result.locationKey]?.name ?? 'its destination';

    if (result.status === 'moving') {
      await tx
        .update(formations)
        .set({
          provinceId: location,
          moveNextProvinceId: ctx.idByKey.get(result.nextKey)!,
          movePath: result.remainingKeys.map((k) => ctx.idByKey.get(k)!),
          moveStartedAt: new Date(result.legStartedAt),
          moveArrivesAt: new Date(result.legArrivesAt),
        })
        .where(eq(formations.id, f.id));
      return [];
    }

    await tx.update(formations).set({ provinceId: location, ...clear }).where(eq(formations.id, f.id));
    const message =
      result.status === 'arrived'
        ? `${f.name} has arrived in ${place}.`
        : `${f.name} halted in ${place}: the way ahead is no longer yours.`;
    return [
      await this.notifications.add(tx, {
        campaignId: f.campaignId,
        countryId,
        type: result.status === 'arrived' ? 'army_arrived' : 'army_halted',
        message,
      }),
    ];
  }
}
