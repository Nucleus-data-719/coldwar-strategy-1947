import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import {
  COAST_SIGHT_HOPS,
  MINE_COST_PER_SHIP,
  MINE_LIFETIME_HOURS,
  MINE_MAX_STRENGTH,
  MINE_SPOT_HOPS,
  MINE_STRENGTH_PER_SHIP,
  PROVINCE_BY_KEY,
  SHIP_SIGHT_HOPS,
  SUB_SPOT_HOPS,
  firingPosition,
  fleetRange,
  formationSpeed,
  hasPort,
  hasSubHunters,
  hopsFrom,
  isHiddenFleet,
  isNavalUnits,
  minelayerCount,
  mineLossPct,
  navalEngagement,
  nodeAtProgress,
  pathLength,
  portNodes,
  seaPathNodes,
  startNodeFromPort,
  voyageSeconds,
  type EnemyFleetDto,
  type Resources,
  type SeaMineDto,
  type UnitType,
} from '@cw/shared';
import { env } from '../config/env';
import { DB, Db, DbOrTx } from '../db/db.module';
import { CountryRow, FormationRow, NotificationRow, formationUnits, formations, provinces, seaMines } from '../db/schema';
import { EconomyService } from '../economy/economy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlayersService } from '../players/players.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WarsService } from '../wars/wars.service';
import { MovementService } from './movement.service';

type Units = { unitType: UnitType; count: number }[];

/** The dot a fleet is at right now, interpolated along its voyage. */
export function currentNode(f: FormationRow, now = Date.now()): number {
  if (f.seaNode === null) return -1;
  if (f.seaArrivesAt && f.seaStartedAt && f.seaPath.length > 1) {
    const span = f.seaArrivesAt.getTime() - f.seaStartedAt.getTime();
    const fraction = span > 0 ? (now - f.seaStartedAt.getTime()) / span : 1;
    return nodeAtProgress(f.seaPath, fraction);
  }
  return f.seaNode;
}

const nameOf = (key: string) => PROVINCE_BY_KEY[key]?.name ?? 'port';

/** Ship orders: sailing along the sea dots, attacking fleets, laying mines. */
@Injectable()
export class NavalService {
  private readonly log = new Logger(NavalService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly economy: EconomyService,
    private readonly players: PlayersService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly wars: WarsService,
    private readonly movement: MovementService,
  ) {}

  private async keys(tx: DbOrTx, campaignId: string) {
    const rows = await tx.select({ id: provinces.id, key: provinces.key, owner: provinces.ownerCountryId }).from(provinces).where(eq(provinces.campaignId, campaignId));
    return { keyById: new Map(rows.map((r) => [r.id, r.key])), rows };
  }

  private async loadOwn(tx: DbOrTx, country: CountryRow, campaignId: string, formationId: string) {
    const [f] = await tx.select().from(formations).where(and(eq(formations.id, formationId), eq(formations.campaignId, campaignId))).for('update');
    if (!f || f.countryId !== country.id) throw new NotFoundException('Fleet not found');
    if (f.moveArrivesAt) throw new BadRequestException('This fleet is following an older order. Cancel it first.');
    return f;
  }

  /** Splits off the chosen ships (only in port) or takes the whole fleet. */
  private async pick(tx: DbOrTx, f: FormationRow, send?: Partial<Record<UnitType, number>>) {
    const rows = await tx.select().from(formationUnits).where(eq(formationUnits.formationId, f.id));
    if (send && Object.keys(send).length > 0) {
      if (f.seaNode !== null) throw new BadRequestException('Fleets at sea cannot be split. Order the whole fleet, or split it in port.');
      const { target, units } = await this.movement.split(tx, f, rows, send);
      if (!isNavalUnits(units)) throw new BadRequestException('Only ships can sail.');
      return { target, units: units as Units };
    }
    const units = rows.map((u) => ({ unitType: u.unitType, count: u.count }));
    if (!isNavalUnits(units)) throw new BadRequestException('Only ships can sail. Land forces move along roads.');
    return { target: f, units };
  }

  private startNode(f: FormationRow, keyById: Map<string, string>, towards: number | undefined): number {
    if (f.seaNode !== null) return currentNode(f);
    const key = keyById.get(f.provinceId)!;
    const n = startNodeFromPort(key, towards);
    if (n === null) throw new BadRequestException('This fleet is in a province without a harbour. It cannot put to sea. Build a harbour first.');
    return n;
  }

  private async setVoyage(tx: DbOrTx, f: FormationRow, path: number[], units: Units, destProvinceId: string | null, attackTargetId: string | null) {
    const now = Date.now();
    const secs = path.length > 1 ? voyageSeconds(pathLength(path), formationSpeed(units), env.GAME_SPEED) : 1;
    await tx
      .update(formations)
      .set({
        seaNode: path[0],
        seaPath: path,
        seaStartedAt: new Date(now),
        seaArrivesAt: new Date(now + secs * 1000),
        seaDestProvinceId: destProvinceId,
        attackTargetId,
        movePatrol: false,
        patrolActive: false,
      })
      .where(eq(formations.id, f.id));
    return secs;
  }

  /** Sail to one of your harbours (`toProvinceId`) or to any open-sea dot (`toNode`). */
  async sail(userId: string, campaignId: string, formationId: string, dest: { toProvinceId?: string; toNode?: number }, send?: Partial<Record<UnitType, number>>) {
    const player = await this.players.require(userId, campaignId);
    const result = await this.economy.lock(player.countryId, async (tx, country) => {
      const f = await this.loadOwn(tx, country, campaignId, formationId);
      const { keyById } = await this.keys(tx, campaignId);
      const { target, units } = await this.pick(tx, f, send);
      let destProvince: string | null = null;
      let goal: number;
      if (dest.toProvinceId) {
        const key = keyById.get(dest.toProvinceId);
        if (!key) throw new NotFoundException('Province not found');
        if (!hasPort(key)) throw new BadRequestException(`${nameOf(key)} has no coast to sail to.`);
        const [p] = await tx.select({ owner: provinces.ownerCountryId }).from(provinces).where(eq(provinces.id, dest.toProvinceId));
        if (p.owner !== country.id) throw new BadRequestException('Fleets can only enter your own harbours. Use the attack order against enemy ships.');
        destProvince = dest.toProvinceId;
        const from = target.seaNode !== null ? currentNode(target) : undefined;
        const ports = portNodes(key);
        const sorted = from === undefined ? ports : [...ports].sort((a, b) => (seaPathNodes(from, a)?.length ?? 1e9) - (seaPathNodes(from, b)?.length ?? 1e9));
        goal = sorted[0];
      } else if (dest.toNode !== undefined) {
        goal = dest.toNode;
      } else throw new BadRequestException('Choose where to sail.');
      const start = this.startNode(target, keyById, goal);
      const path = seaPathNodes(start, goal);
      if (!path) throw new BadRequestException('No sea route there.');
      if (path.length === 1 && !destProvince) throw new BadRequestException('The fleet is already there.');
      const eta = await this.setVoyage(tx, target, path, units, destProvince, null);
      return { formationId: target.id, etaSeconds: eta };
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'move' });
    return { ok: true, ...result };
  }

  /** Attack a visible enemy fleet at sea. The fleet closes in until all its ships are within range, then fires. */
  async attack(userId: string, campaignId: string, formationId: string, targetId: string, send?: Partial<Record<UnitType, number>>) {
    const player = await this.players.require(userId, campaignId);
    const result = await this.economy.lock(player.countryId, async (tx, country) => {
      const f = await this.loadOwn(tx, country, campaignId, formationId);
      const { keyById } = await this.keys(tx, campaignId);
      const [enemy] = await tx.select().from(formations).where(and(eq(formations.id, targetId), eq(formations.campaignId, campaignId)));
      if (!enemy || enemy.seaNode === null) throw new BadRequestException('That fleet is no longer at sea.');
      const atWar = await this.wars.enemiesOf(tx, country.id);
      if (!atWar.has(enemy.countryId)) throw new BadRequestException('You are not at war with that country.');
      const view = await this.seaView(tx, campaignId, country.id, keyById);
      if (!view.enemies.some((e) => e.id === enemy.id)) throw new BadRequestException('You cannot see that fleet. Get a destroyer or corvette closer to find it.');
      const { target, units } = await this.pick(tx, f, send);
      const tpos = currentNode(enemy);
      const start = this.startNode(target, keyById, tpos);
      const path = seaPathNodes(start, tpos);
      if (!path) throw new BadRequestException('No sea route to that fleet.');
      const course = firingPosition(path, tpos, fleetRange(units));
      const eta = await this.setVoyage(tx, target, course, units, null, enemy.id);
      return { formationId: target.id, etaSeconds: eta };
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'move' });
    return { ok: true, ...result };
  }

  /** Lay a mine field on the dot the fleet is sitting at. Submarines, destroyers and corvettes can do it. */
  async layMines(userId: string, campaignId: string, formationId: string) {
    const player = await this.players.require(userId, campaignId);
    const result = await this.economy.lock(player.countryId, async (tx, country) => {
      const f = await this.loadOwn(tx, country, campaignId, formationId);
      if (f.seaNode === null) throw new BadRequestException('Mines are laid at sea. Sail out first.');
      if (f.seaArrivesAt) throw new BadRequestException('Stop the fleet before laying mines.');
      const units = (await tx.select().from(formationUnits).where(eq(formationUnits.formationId, f.id))) as Units;
      const layers = minelayerCount(units);
      if (layers <= 0) throw new BadRequestException('Only submarines, destroyers and corvettes can lay mines.');
      const balance = await this.economy.settle(tx, country);
      const cost: Partial<Resources> = {};
      for (const [k, v] of Object.entries(MINE_COST_PER_SHIP)) cost[k as keyof Resources] = (v as number) * layers;
      const next = { ...balance };
      for (const [k, v] of Object.entries(cost)) {
        if (balance[k as keyof Resources] < (v as number)) throw new BadRequestException(`Not enough ${k} to lay mines (${v} needed).`);
        next[k as keyof Resources] = balance[k as keyof Resources] - (v as number);
      }
      await this.economy.writeBalance(tx, country.id, next);
      const expiresAt = new Date(Date.now() + ((MINE_LIFETIME_HOURS * 3600) / env.GAME_SPEED) * 1000);
      const [existing] = await tx.select().from(seaMines).where(and(eq(seaMines.campaignId, campaignId), eq(seaMines.countryId, country.id), eq(seaMines.node, f.seaNode)));
      const add = layers * MINE_STRENGTH_PER_SHIP;
      if (existing) await tx.update(seaMines).set({ strength: Math.min(MINE_MAX_STRENGTH, existing.strength + add), expiresAt }).where(eq(seaMines.id, existing.id));
      else await tx.insert(seaMines).values({ campaignId, countryId: country.id, node: f.seaNode, strength: Math.min(MINE_MAX_STRENGTH, add), expiresAt });
      return { strength: Math.min(MINE_MAX_STRENGTH, (existing?.strength ?? 0) + add) };
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'move' });
    return { ok: true, ...result };
  }

  /** Cancel orders. A fleet at sea stops where it is; anything else falls back to the land/air rules. */
  async stop(userId: string, campaignId: string, formationId: string) {
    const player = await this.players.require(userId, campaignId);
    const [f0] = await this.db.select({ seaNode: formations.seaNode, seaArrivesAt: formations.seaArrivesAt }).from(formations).where(eq(formations.id, formationId));
    if (!f0 || f0.seaNode === null) return this.movement.stop(userId, campaignId, formationId);
    await this.economy.lock(player.countryId, async (tx, country) => {
      const [f] = await tx.select().from(formations).where(and(eq(formations.id, formationId), eq(formations.campaignId, campaignId))).for('update');
      if (!f || f.countryId !== country.id) throw new NotFoundException('Fleet not found');
      if (!f.seaArrivesAt) throw new BadRequestException('This fleet has no orders.');
      const here = currentNode(f);
      await tx.update(formations).set({ seaNode: here, seaPath: [], seaStartedAt: null, seaArrivesAt: null, seaDestProvinceId: null, attackTargetId: null }).where(eq(formations.id, f.id));
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'move' });
    return { ok: true };
  }

  // ------------------------------------------------------------------ what you can see

  /** Enemy fleets and mines that this country can currently see. */
  async seaView(tx: DbOrTx, campaignId: string, countryId: string, keyById: Map<string, string>): Promise<{ enemies: EnemyFleetDto[]; mines: SeaMineDto[] }> {
    const enemyIds = [...(await this.wars.enemiesOf(tx, countryId))];
    const now = Date.now();
    const mineRows = await tx.select().from(seaMines).where(and(eq(seaMines.campaignId, campaignId)));
    const all = await tx.select().from(formations).where(and(eq(formations.campaignId, campaignId)));
    const mine = all.filter((f) => f.countryId === countryId);
    const unitRows = all.length ? await tx.select().from(formationUnits).where(inArray(formationUnits.formationId, all.map((f) => f.id))) : [];
    const unitsOf = (id: string): Units => unitRows.filter((u) => u.formationId === id).map((u) => ({ unitType: u.unitType, count: u.count }));

    // Where my eyes are. `sight` sees ships; `hunt` sees submarines and mines.
    const sight: number[] = [];
    const hunt: number[] = [];
    for (const f of mine) {
      const units = unitsOf(f.id);
      if (!isNavalUnits(units)) continue;
      const nodes = f.seaNode !== null ? [currentNode(f, now)] : portNodes(keyById.get(f.provinceId) ?? '');
      if (f.seaNode !== null) sight.push(...nodes);
      if (hasSubHunters(units)) hunt.push(...nodes);
    }
    const coast: number[] = [];
    const owned = await tx.select({ key: provinces.key }).from(provinces).where(and(eq(provinces.campaignId, campaignId), eq(provinces.ownerCountryId, countryId)));
    for (const p of owned) if (hasPort(p.key)) coast.push(...portNodes(p.key));

    const seen = hopsFrom(sight, SHIP_SIGHT_HOPS);
    const seenCoast = hopsFrom(coast, COAST_SIGHT_HOPS);
    const spotted = hopsFrom(hunt, SUB_SPOT_HOPS);
    const nearHunters = hopsFrom(hunt, MINE_SPOT_HOPS);

    const enemies: EnemyFleetDto[] = [];
    for (const e of all) {
      if (!enemyIds.includes(e.countryId) || e.seaNode === null) continue;
      const units = unitsOf(e.id);
      if (!isNavalUnits(units)) continue;
      const node = currentNode(e, now);
      const visible = seen.has(node) || seenCoast.has(node);
      const hidden = isHiddenFleet(units);
      if (hidden ? !spotted.has(node) : !visible && !spotted.has(node)) continue;
      const path = e.seaArrivesAt ? e.seaPath : [];
      enemies.push({
        id: e.id,
        countryId: e.countryId,
        node,
        toNode: path.length > 1 ? path[path.length - 1] : null,
        ships: units.reduce((s, u) => s + u.count, 0),
        submarines: units.some((u) => u.unitType === 'submarine' && u.count > 0),
      });
    }
    const mines: SeaMineDto[] = [];
    for (const m of mineRows) {
      if (m.expiresAt.getTime() <= now) continue;
      if (m.countryId === countryId) mines.push({ id: m.id, countryId: m.countryId, node: m.node, strength: m.strength, expiresAt: m.expiresAt.toISOString(), mine: true });
      else if (nearHunters.has(m.node)) mines.push({ id: m.id, countryId: m.countryId, node: m.node, strength: m.strength, expiresAt: m.expiresAt.toISOString(), mine: false });
    }
    return { enemies, mines };
  }

  // ------------------------------------------------------------------ scheduler

  async processDue(): Promise<void> {
    await this.db.delete(seaMines).where(lte(seaMines.expiresAt, new Date()));
    const due = await this.db
      .select({ id: formations.id, countryId: formations.countryId, campaignId: formations.campaignId, target: formations.attackTargetId })
      .from(formations)
      .where(and(isNotNull(formations.seaArrivesAt), lte(formations.seaArrivesAt, new Date())))
      .limit(100);
    for (const d of due) {
      try {
        let targetOwner: string | undefined;
        if (d.target) {
          const [t] = await this.db.select({ c: formations.countryId }).from(formations).where(eq(formations.id, d.target));
          targetOwner = t?.c;
        }
        const notes = await this.economy.lockMany([d.countryId, ...(targetOwner ? [targetOwner] : [])], (tx) => this.arrive(tx, d.id));
        for (const n of notes) this.notifications.publish(n);
        this.realtime.campaignUpdate(d.campaignId, { kind: notes.some((n) => n.type.startsWith('battle')) ? 'battle' : 'move' });
      } catch (err) {
        this.log.warn(`naval ${d.id}: ${(err as Error).message}`);
      }
    }
  }

  private async arrive(tx: DbOrTx, formationId: string): Promise<NotificationRow[]> {
    const [f] = await tx.select().from(formations).where(eq(formations.id, formationId)).for('update');
    if (!f || !f.seaArrivesAt || f.seaArrivesAt.getTime() > Date.now()) return [];
    const notes: NotificationRow[] = [];
    const say = async (countryId: string, type: string, message: string) => notes.push(await this.notifications.add(tx, { campaignId: f.campaignId, countryId, type, message }));
    const clear = { seaPath: [] as number[], seaStartedAt: null, seaArrivesAt: null, seaDestProvinceId: null, attackTargetId: null };
    const path = f.seaPath;
    let units = (await tx.select().from(formationUnits).where(eq(formationUnits.formationId, f.id))) as (Units[number] & { id: string })[];
    const destroy = async () => {
      await tx.delete(formations).where(eq(formations.id, f.id));
    };

    // 1. Mines on the way.
    const atWar = await this.wars.enemiesOf(tx, f.countryId);
    if (path.length > 1 && atWar.size) {
      const fields = await tx.select().from(seaMines).where(and(eq(seaMines.campaignId, f.campaignId), inArray(seaMines.countryId, [...atWar]), inArray(seaMines.node, path.slice(1))));
      for (const m of fields) {
        if (m.expiresAt.getTime() <= Date.now()) continue;
        const pct = mineLossPct(m.strength) * (hasSubHunters(units) ? 0.5 : 1);
        let lost = 0;
        for (const u of units) {
          const gone = Math.min(u.count, Math.round(u.count * pct));
          lost += gone;
          if (gone > 0) {
            u.count -= gone;
            await tx.update(formationUnits).set({ count: u.count }).where(eq(formationUnits.id, u.id));
          }
        }
        const left = m.strength - 4;
        if (left <= 0) await tx.delete(seaMines).where(eq(seaMines.id, m.id));
        else await tx.update(seaMines).set({ strength: left }).where(eq(seaMines.id, m.id));
        if (lost > 0) {
          await say(f.countryId, 'battle_mines', `${f.name} sailed into a mine field and lost ${lost} ship${lost === 1 ? '' : 's'}.`);
          await say(m.countryId, 'battle_mines', `Your mines sank ${lost} enemy ship${lost === 1 ? '' : 's'}.`);
        }
      }
      units = units.filter((u) => u.count > 0);
      await tx.delete(formationUnits).where(and(eq(formationUnits.formationId, f.id), eq(formationUnits.count, 0)));
      if (units.length === 0) {
        await destroy();
        await say(f.countryId, 'battle_mines', `${f.name} was lost to mines.`);
        return notes;
      }
    }

    const here = path.length ? path[path.length - 1] : (f.seaNode as number);

    // 2. Hunting an enemy fleet.
    if (f.attackTargetId) {
      const [enemy] = await tx.select().from(formations).where(eq(formations.id, f.attackTargetId)).for('update');
      const enemyUnitRows = enemy ? await tx.select().from(formationUnits).where(eq(formationUnits.formationId, enemy.id)) : [];
      const range = fleetRange(units);
      const tpos = enemy && enemy.seaNode !== null ? currentNode(enemy) : -1;
      const hops = tpos >= 0 ? hopsFrom([here], range).get(tpos) : undefined;
      const hiddenTarget = enemy && isHiddenFleet(enemyUnitRows);
      const spotted = hopsFrom([here], SUB_SPOT_HOPS).has(tpos) && hasSubHunters(units);
      if (!enemy || hops === undefined || (hiddenTarget && !spotted) || !atWar.has(enemy.countryId)) {
        await tx.update(formations).set({ seaNode: here, ...clear }).where(eq(formations.id, f.id));
        await say(f.countryId, 'naval_contact_lost', `${f.name} lost contact with the enemy fleet.`);
        return notes;
      }
      const seed = (Date.now() ^ f.id.charCodeAt(0) * 7919) >>> 0;
      const res = navalEngagement({
        seed,
        attackerUnits: units,
        defenderUnits: enemyUnitRows.map((u) => ({ unitType: u.unitType, count: u.count })),
        hops,
      });
      const apply = async (formationRowId: string, rows: { id: string; unitType: UnitType }[], after: Units) => {
        for (const r of rows) {
          const keep = after.find((a) => a.unitType === r.unitType)?.count ?? 0;
          if (keep <= 0) await tx.delete(formationUnits).where(eq(formationUnits.id, r.id));
          else await tx.update(formationUnits).set({ count: keep }).where(eq(formationUnits.id, r.id));
        }
        if (after.length === 0) await tx.delete(formations).where(eq(formations.id, formationRowId));
      };
      await apply(f.id, units, res.attackerAfter);
      await apply(enemy.id, enemyUnitRows, res.defenderAfter);
      if (res.attackerAfter.length > 0) await tx.update(formations).set({ seaNode: here, ...clear }).where(eq(formations.id, f.id));
      if (res.defenderAfter.length > 0) await tx.update(formations).set({ seaNode: tpos, ...clear }).where(eq(formations.id, enemy.id));
      const word = res.defenderAfter.length === 0 ? 'destroyed' : res.attackerAfter.length === 0 ? 'was destroyed' : 'fought';
      await say(f.countryId, 'battle_naval', `${f.name} ${word === 'was destroyed' ? 'was destroyed in' : word === 'destroyed' ? 'destroyed the enemy fleet in' : 'fought'} a naval battle: you lost ${res.attackerLossPct}%, the enemy lost ${res.defenderLossPct}%.`);
      await say(enemy.countryId, 'battle_naval', `${enemy.name} was attacked at sea: you lost ${res.defenderLossPct}%, the enemy lost ${res.attackerLossPct}%.`);
      return notes;
    }

    // 3. Plain arrival.
    if (f.seaDestProvinceId) {
      const [p] = await tx.select({ key: provinces.key, owner: provinces.ownerCountryId }).from(provinces).where(eq(provinces.id, f.seaDestProvinceId));
      if (p && p.owner === f.countryId) {
        await tx.update(formations).set({ provinceId: f.seaDestProvinceId, seaNode: null, ...clear }).where(eq(formations.id, f.id));
        await say(f.countryId, 'army_arrived', `${f.name} has docked in ${nameOf(p.key)}.`);
        return notes;
      }
      await tx.update(formations).set({ seaNode: here, ...clear }).where(eq(formations.id, f.id));
      await say(f.countryId, 'army_halted', `${f.name} could not dock: the harbour is no longer yours.`);
      return notes;
    }
    await tx.update(formations).set({ seaNode: here, ...clear }).where(eq(formations.id, f.id));
    await say(f.countryId, 'army_arrived', `${f.name} has reached its position at sea.`);
    return notes;
  }
}
