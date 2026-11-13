import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, isNotNull, lt, lte } from 'drizzle-orm';
import {
  PROVINCE_BY_KEY,
  UNITS,
  advanceMovement,
  formationSpeed,
  isNavalFormation,
  planRoute,
  canOccupyLand,
  PATROL_MAX_FLIGHT,
  isAirFormation,
  patrolDistance,
  patrolFlightSeconds,
  type UnitType,
} from '@cw/shared';
import { env } from '../config/env';
import { DB, Db, DbOrTx } from '../db/db.module';
import {
  buildings,
  CountryRow,
  formationUnits,
  formations,
  FormationRow,
  FormationUnitRow,
  NotificationRow,
  provinces,
} from '../db/schema';
import { EconomyService } from '../economy/economy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlayersService } from '../players/players.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WarsService } from '../wars/wars.service';
import { CombatService } from './combat.service';
import { mergeIdleAt } from './merge';

/** Land forces move along roads; ships and aircraft are not bound to them. */
const usesRoads = (units: { unitType: UnitType; count: number }[]) => !isNavalFormation(units) && canOccupyLand(units);

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
    private readonly wars: WarsService,
    private readonly combat: CombatService,
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
      .where(and(eq(buildings.campaignId, campaignId), eq(buildings.type, 'railway'), eq(buildings.status, 'complete'), lt(buildings.damage, 50)));
    const railwayKeys = new Set(rails.map((r) => keyById.get(r.provinceId)).filter((k): k is string => !!k));
    return { keyById, idByKey, ownerByKey, railwayKeys };
  }

  /** Splits the chosen units off into a new formation in the same province. Returns the formation to move. */
  async split(
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
    waypoint = false,
    point?: { x: number; y: number } | null,
    declareWar = false,
  ) {
    const player = await this.players.require(userId, campaignId);

    if (declareWar) {
      // An order into the land of a country you are not at war with declares war on it first, as in Conflict of Nations.
      const [dest] = await this.db
        .select({ owner: provinces.ownerCountryId })
        .from(provinces)
        .where(and(eq(provinces.id, destinationProvinceId), eq(provinces.campaignId, campaignId)));
      if (dest && dest.owner !== player.countryId && !(await this.wars.enemiesOf(this.db, player.countryId)).has(dest.owner)) {
        await this.wars.declare(userId, campaignId, dest.owner);
      }
    }

    const result = await this.economy.lock(player.countryId, (tx, country) =>
      this.orderFor(tx, country, campaignId, formationId, destinationProvinceId, send, waypoint, point ?? null),
    );

    this.realtime.campaignUpdate(campaignId, { kind: 'move' });
    return { ok: true, ...result };
  }

  /** The core of a move order. Must run inside a lock on `country`. The AI uses it too. */
  async orderFor(
    tx: DbOrTx,
    country: CountryRow,
    campaignId: string,
    formationId: string,
    destinationProvinceId: string,
    send?: Partial<Record<UnitType, number>>,
    waypoint = false,
    point: { x: number; y: number } | null = null,
    front: string | null = null,
  ): Promise<{ formationId: string; etaSeconds: number }> {
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

    // A waypoint is added at the end of the route the army already has; a normal order replaces what follows the current leg.
    const startId = moving ? (waypoint ? (target.movePath.at(-1) ?? target.moveNextProvinceId!) : target.moveNextProvinceId!) : target.provinceId;
    const startKey = ctx.keyById.get(startId)!;
    if (!moving && startKey === destKey) {
      // Same province: with a spot chosen the army just takes up position there.
      if (!point) throw new BadRequestException('The army is already in that province');
      await tx.update(formations).set({ restX: point.x, restY: point.y, frontCountryId: front }).where(eq(formations.id, target.id));
      return { formationId: target.id, etaSeconds: 0 };
    }

    const route = planRoute(startKey, destKey, {
      countryId: country.id,
      ownerByKey: ctx.ownerByKey,
      atWarWith: await this.wars.enemiesOf(tx, country.id),
      railwayKeys: ctx.railwayKeys,
      speed,
      gameSpeed: env.GAME_SPEED,
      coastalOnly: isNavalFormation(units),
      useRoads: usesRoads(units),
    });
    if (!route) {
      throw new BadRequestException(
        isNavalFormation(units)
          ? 'No sea route. Ships can only sail between coastal provinces.'
          : 'No route. Land forces travel only along roads, across your own land and the land of countries you are at war with. Declare war first to attack.',
      );
    }

    const ids = route.path.map((k) => ctx.idByKey.get(k)!);
    if (moving) {
      await tx
        .update(formations)
        .set({ movePath: waypoint ? [...target.movePath, ...ids.slice(1)] : ids.slice(1), movePatrol: false, restX: point?.x ?? null, restY: point?.y ?? null, frontCountryId: front })
        .where(eq(formations.id, target.id));
    } else {
      const now = new Date();
      await tx
        .update(formations)
        .set({
          moveNextProvinceId: ids[1],
          movePath: ids.slice(2),
          moveStartedAt: now,
          moveArrivesAt: new Date(now.getTime() + route.legSeconds[0] * 1000),
          movePatrol: false,
          patrolActive: false,
          patrolSince: null,
          patrolSettledAt: null,
          restX: point?.x ?? null,
          restY: point?.y ?? null,
          frontCountryId: front,
        })
        .where(eq(formations.id, target.id));
    }
    return { formationId: target.id, etaSeconds: route.totalSeconds };
  }

  /**
   * Player command: send aircraft to patrol over a province. They fly straight there (any province, any owner,
   * within range) and then hold the patrol until it is cancelled. See PatrolService for what a patrol does.
   */
  async orderPatrol(
    userId: string,
    campaignId: string,
    formationId: string,
    destinationProvinceId: string,
    send?: Partial<Record<UnitType, number>>,
  ) {
    const player = await this.players.require(userId, campaignId);
    const result = await this.economy.lock(player.countryId, (tx, country) =>
      this.orderPatrolFor(tx, country, campaignId, formationId, destinationProvinceId, send),
    );
    this.realtime.campaignUpdate(campaignId, { kind: 'move' });
    return { ok: true, ...result };
  }

  /** The core of a patrol order. Must run inside a lock on `country`. The AI uses it too. */
  async orderPatrolFor(
    tx: DbOrTx,
    country: CountryRow,
    campaignId: string,
    formationId: string,
    destinationProvinceId: string,
    send?: Partial<Record<UnitType, number>>,
  ): Promise<{ formationId: string; etaSeconds: number }> {
    const [formation] = await tx
      .select()
      .from(formations)
      .where(and(eq(formations.id, formationId), eq(formations.campaignId, campaignId)))
      .for('update');
    if (!formation || formation.countryId !== country.id) throw new NotFoundException('Army not found');
    if (formation.moveArrivesAt) throw new BadRequestException('Wait for the aircraft to land, or cancel their orders first');

    const ctx = await this.loadContext(tx, campaignId);
    const destKey = ctx.keyById.get(destinationProvinceId);
    if (!destKey) throw new NotFoundException('Province not found');

    let target: FormationRow = formation;
    const unitRows = await tx.select().from(formationUnits).where(eq(formationUnits.formationId, formation.id));
    let units: { unitType: UnitType; count: number }[] = unitRows;
    if (send && Object.keys(send).length > 0) ({ target, units } = await this.split(tx, formation, unitRows, send));
    if (!isAirFormation(units)) throw new BadRequestException('Only aircraft can patrol. Send the aircraft as a separate force.');

    const startKey = ctx.keyById.get(target.provinceId)!;
    if (patrolDistance(startKey, destKey) > PATROL_MAX_FLIGHT) throw new BadRequestException('Too far for these aircraft. Patrol closer to where they are based.');
    const now = new Date();
    if (startKey === destKey) {
      await tx.update(formations).set({ patrolActive: true, patrolSince: now, patrolSettledAt: now, movePatrol: false }).where(eq(formations.id, target.id));
      return { formationId: target.id, etaSeconds: 0 };
    }
    const seconds = patrolFlightSeconds(startKey, destKey, formationSpeed(units), env.GAME_SPEED);
    await tx
      .update(formations)
      .set({
        moveNextProvinceId: destinationProvinceId,
        movePath: [],
        moveStartedAt: now,
        moveArrivesAt: new Date(now.getTime() + seconds * 1000),
        movePatrol: true,
        patrolActive: false,
        patrolSince: null,
        patrolSettledAt: null,
      })
      .where(eq(formations.id, target.id));
    return { formationId: target.id, etaSeconds: seconds };
  }

  /**
   * Player command: cancel the order. An army heading into its own land finishes the current leg and halts.
   * An army about to attack turns back instead: it returns to the province it left, taking as long as it
   * has already marched.
   */
  /**
   * Hold a marching army where it stands for `hours` game hours (0 cancels a delay). The leg's start and arrival
   * times slide back by the same amount, so the whole route arrives that much later.
   */
  async delay(userId: string, campaignId: string, formationId: string, hours: number) {
    const player = await this.players.require(userId, campaignId);
    await this.economy.lock(player.countryId, async (tx, country) => {
      const [f] = await tx.select().from(formations).where(and(eq(formations.id, formationId), eq(formations.campaignId, campaignId))).for('update');
      if (!f || f.countryId !== country.id) throw new NotFoundException('Army not found');
      if (!f.moveArrivesAt || !f.moveStartedAt || !f.moveNextProvinceId) throw new BadRequestException('That army is not moving');
      const now = Date.now();
      const span = Math.max(1000, f.moveArrivesAt.getTime() - f.moveStartedAt.getTime());
      const held = !!f.moveHoldUntil && f.moveHoldUntil.getTime() > now;
      // How far along the leg the army stands.
      const p = held ? (f.moveHoldFraction ?? 0) : Math.min(1, Math.max(0, (now - f.moveStartedAt.getTime()) / span));
      const seconds = Math.round((hours * 3600) / env.GAME_SPEED);
      const arrives = now + seconds * 1000 + Math.round((1 - p) * span);
      await tx
        .update(formations)
        .set({
          moveStartedAt: new Date(arrives - span),
          moveArrivesAt: new Date(arrives),
          moveHoldUntil: seconds > 0 ? new Date(now + seconds * 1000) : null,
          moveHoldFraction: seconds > 0 ? p : null,
        })
        .where(eq(formations.id, f.id));
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'move' });
    return { ok: true };
  }

  async stop(userId: string, campaignId: string, formationId: string) {
    const player = await this.players.require(userId, campaignId);
    await this.economy.lock(player.countryId, async (tx, country) => {
      const [formation] = await tx
        .select()
        .from(formations)
        .where(and(eq(formations.id, formationId), eq(formations.campaignId, campaignId)))
        .for('update');
      if (!formation || formation.countryId !== country.id) throw new NotFoundException('Army not found');
      if (formation.patrolActive && !formation.moveArrivesAt) {
        // End the patrol: the aircraft stay where they are.
        await tx.update(formations).set({ patrolActive: false, patrolSince: null, patrolSettledAt: null }).where(eq(formations.id, formation.id));
        return;
      }
      if (formation.movePatrol) {
        // Still flying out to patrol: finish the flight but do not start the patrol.
        await tx.update(formations).set({ movePatrol: false, movePath: [] }).where(eq(formations.id, formation.id));
        return;
      }
      if (!formation.moveArrivesAt || !formation.moveNextProvinceId) throw new BadRequestException('That army is not moving');

      const [next] = await tx.select({ owner: provinces.ownerCountryId }).from(provinces).where(eq(provinces.id, formation.moveNextProvinceId));
      if (next?.owner === country.id || !formation.moveStartedAt) {
        await tx.update(formations).set({ movePath: [] }).where(eq(formations.id, formation.id));
        return;
      }
      // Retreat: the way back takes as long as the way already marched.
      const now = Date.now();
      const marched = Math.max(1000, Math.min(now - formation.moveStartedAt.getTime(), formation.moveArrivesAt.getTime() - formation.moveStartedAt.getTime()));
      await tx
        .update(formations)
        .set({
          moveNextProvinceId: formation.provinceId,
          movePath: [],
          moveStartedAt: new Date(now),
          moveArrivesAt: new Date(now + marched),
          moveHoldUntil: null,
          moveHoldFraction: null,
        })
        .where(eq(formations.id, formation.id));
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'move' });
    return { ok: true };
  }

  /** Scheduler hook: applies every leg whose arrival time has passed, fighting battles on the way. */
  async processDue(): Promise<void> {
    const due = await this.db
      .select({
        id: formations.id,
        countryId: formations.countryId,
        campaignId: formations.campaignId,
        nextProvinceId: formations.moveNextProvinceId,
      })
      .from(formations)
      .where(and(isNotNull(formations.moveArrivesAt), lte(formations.moveArrivesAt, new Date())))
      .limit(200);

    for (const d of due) {
      try {
        // The owner of the province being entered may be an enemy: lock both countries.
        let ownerId: string | undefined;
        if (d.nextProvinceId) {
          [{ ownerId }] = await this.db
            .select({ ownerId: provinces.ownerCountryId })
            .from(provinces)
            .where(eq(provinces.id, d.nextProvinceId));
        }
        const notes = await this.economy.lockMany([d.countryId, ...(ownerId ? [ownerId] : [])], (tx, locked) =>
          this.advance(tx, locked, d.id),
        );
        for (const n of notes) this.notifications.publish(n);
        this.realtime.campaignUpdate(d.campaignId, { kind: notes.some((n) => n.type.startsWith('battle') || n.type === 'province_lost') ? 'battle' : 'move' });
      } catch (err) {
        this.log.warn(`movement ${d.id}: ${(err as Error).message}`);
      }
    }
  }

  private async advance(tx: DbOrTx, locked: Map<string, CountryRow>, formationId: string): Promise<NotificationRow[]> {
    const [f] = await tx.select().from(formations).where(eq(formations.id, formationId)).for('update');
    if (!f || !f.moveArrivesAt || !f.moveNextProvinceId || f.moveArrivesAt.getTime() > Date.now()) return [];
    const countryId = f.countryId;
    if (f.movePatrol) {
      // Aircraft arriving to patrol: no battle, they start circling over the province.
      const key = await tx.select({ key: provinces.key }).from(provinces).where(eq(provinces.id, f.moveNextProvinceId));
      const at = new Date(f.moveArrivesAt.getTime());
      await tx
        .update(formations)
        .set({ provinceId: f.moveNextProvinceId, moveNextProvinceId: null, movePath: [], moveStartedAt: null, moveArrivesAt: null, movePatrol: false, patrolActive: true, patrolSince: at, patrolSettledAt: at })
        .where(eq(formations.id, f.id));
      return [
        await this.notifications.add(tx, {
          campaignId: f.campaignId,
          countryId,
          type: 'army_arrived',
          message: `${f.name} is on patrol over ${PROVINCE_BY_KEY[key[0]?.key ?? '']?.name ?? 'its patrol area'}.`,
        }),
      ];
    }
    const attacker = locked.get(countryId)!;

    const ctx = await this.loadContext(tx, f.campaignId);
    const atWarWith = await this.wars.enemiesOf(tx, countryId);
    let units = await tx.select().from(formationUnits).where(eq(formationUnits.formationId, f.id));

    const step = (locationKey: string, nextKey: string, remainingKeys: string[], legArrivesAt: number) =>
      advanceMovement({
        locationKey,
        nextKey,
        remainingKeys,
        legArrivesAt,
        now: Date.now(),
        speed: formationSpeed(units),
        gameSpeed: env.GAME_SPEED,
        countryId,
        ownerByKey: ctx.ownerByKey,
        atWarWith,
        railwayKeys: ctx.railwayKeys,
        useRoads: usesRoads(units),
        coastalOnly: isNavalFormation(units),
      });

    let result = step(
      ctx.keyById.get(f.provinceId)!,
      ctx.keyById.get(f.moveNextProvinceId)!,
      f.movePath.map((id) => ctx.keyById.get(id)!).filter(Boolean),
      f.moveArrivesAt.getTime(),
    );

    const notes: NotificationRow[] = [];
    let fought = false;
    while (result.status === 'battle') {
      const defenderId = ctx.ownerByKey.get(result.targetKey)!;
      const defender = locked.get(defenderId);
      if (!defender) {
        // A different enemy owns the next province: park the army and let the next tick lock it.
        await tx
          .update(formations)
          .set({
            provinceId: ctx.idByKey.get(result.locationKey)!,
            moveNextProvinceId: ctx.idByKey.get(result.targetKey)!,
            movePath: result.remainingKeys.map((k) => ctx.idByKey.get(k)!),
            moveStartedAt: new Date(result.arrivedAt),
            moveArrivesAt: new Date(result.arrivedAt),
          })
          .where(eq(formations.id, f.id));
        return notes;
      }

      const [province] = await tx.select().from(provinces).where(eq(provinces.id, ctx.idByKey.get(result.targetKey)!));
      const outcome = await this.combat.resolveAttack(tx, {
        formation: f,
        units,
        attacker,
        defender,
        province,
        arrivedAt: result.arrivedAt,
      });
      notes.push(...outcome.notes);
      fought = true;
      if (!outcome.won) return notes; // the army no longer exists
      if (!outcome.captured) {
        // Ships and aircraft cannot occupy land: they stay where they were.
        await tx
          .update(formations)
          .set({ provinceId: ctx.idByKey.get(result.locationKey)!, moveNextProvinceId: null, movePath: [], moveStartedAt: null, moveArrivesAt: null })
          .where(eq(formations.id, f.id));
        return notes;
      }

      ctx.ownerByKey.set(result.targetKey, countryId);
      units = await tx.select().from(formationUnits).where(eq(formationUnits.formationId, f.id));
      result = step(result.locationKey, result.targetKey, result.remainingKeys, result.arrivedAt);
    }

    const clear = { moveNextProvinceId: null, movePath: [] as string[], moveStartedAt: null, moveArrivesAt: null, moveHoldUntil: null, moveHoldFraction: null };
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
          moveHoldUntil: null,
          moveHoldFraction: null,
        })
        .where(eq(formations.id, f.id));
      return notes;
    }

    await tx.update(formations).set({ provinceId: location, ...clear }).where(eq(formations.id, f.id));
    if (!attacker.aiControlled) await mergeIdleAt(tx, f.id); // players' armies in one place join up; the AI keeps its own bookkeeping
    if (result.status === 'arrived' && fought) return notes; // the capture message already says it
    notes.push(
      await this.notifications.add(tx, {
        campaignId: f.campaignId,
        countryId,
        type: result.status === 'arrived' ? 'army_arrived' : 'army_halted',
        message:
          result.status === 'arrived'
            ? `${f.name} has arrived in ${place}.`
            : `${f.name} halted in ${place}: the way ahead is closed to it.`,
      }),
    );
    return notes;
  }
}
