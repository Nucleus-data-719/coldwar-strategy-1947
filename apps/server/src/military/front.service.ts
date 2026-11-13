import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { PROVINCE_BY_KEY, type UnitType, armyDomain, borderProvinceKeys, canOccupyLand, distributeToBorder, isNavalFormation } from '@cw/shared';
import { DB, Db } from '../db/db.module';
import { countries, formationUnits, formations, provinces } from '../db/schema';
import { EconomyService } from '../economy/economy.service';
import { PlayersService } from '../players/players.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WarsService } from '../wars/wars.service';
import { MovementService } from './movement.service';

/**
 * Assign Front Line, as in Hearts of Iron IV: the army spreads out along the border with one country so every border
 * province is covered, and when war with that country comes the army advances and attacks until the land is taken.
 */
@Injectable()
export class FrontService {
  private readonly log = new Logger(FrontService.name);
  private lastRun = 0;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly economy: EconomyService,
    private readonly players: PlayersService,
    private readonly movement: MovementService,
    private readonly wars: WarsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Player command. `targetCountryId` null takes the army off the front. */
  async assign(userId: string, campaignId: string, formationId: string, targetCountryId: string | null) {
    const player = await this.players.require(userId, campaignId);
    const result = await this.economy.lock(player.countryId, async (tx, country) => {
      const [formation] = await tx
        .select()
        .from(formations)
        .where(and(eq(formations.id, formationId), eq(formations.campaignId, campaignId)))
        .for('update');
      if (!formation || formation.countryId !== country.id) throw new NotFoundException('Army not found');
      if (targetCountryId === null) {
        await tx.update(formations).set({ frontCountryId: null }).where(eq(formations.id, formation.id));
        return { assigned: 0, provinces: [] as string[] };
      }
      if (formation.moveArrivesAt) throw new BadRequestException('Wait for the army to arrive, or cancel its orders first');
      if (formation.patrolActive || formation.seaNode !== null) throw new BadRequestException('Only land armies can hold a front');
      const units = await tx.select().from(formationUnits).where(eq(formationUnits.formationId, formation.id));
      if (armyDomain(units) !== 'land' || isNavalFormation(units) || !canOccupyLand(units)) throw new BadRequestException('Only land armies can hold a front');
      const [target] = await tx.select().from(countries).where(and(eq(countries.id, targetCountryId), eq(countries.campaignId, campaignId)));
      if (!target || target.id === country.id) throw new NotFoundException('Country not found');

      const rows = await tx
        .select({ id: provinces.id, key: provinces.key, owner: provinces.ownerCountryId })
        .from(provinces)
        .where(eq(provinces.campaignId, campaignId));
      const ownerByKey = new Map(rows.map((r) => [r.key, r.owner]));
      const idByKey = new Map(rows.map((r) => [r.key, r.id]));
      const keys = borderProvinceKeys(country.id, target.id, ownerByKey);
      if (keys.length === 0) throw new BadRequestException(`Your land does not border ${target.name}`);
      const plan = distributeToBorder(keys, units);
      const here = rows.find((r) => r.id === formation.provinceId)?.key ?? '';

      const guards: string[] = [];
      const done: string[] = [];
      for (const part of plan) {
        const send = Object.fromEntries(part.units.map((u) => [u.unitType, u.count])) as Partial<Record<UnitType, number>>;
        try {
          if (part.key === here) {
            const rowsNow = await tx.select().from(formationUnits).where(eq(formationUnits.formationId, formation.id));
            const [fresh] = await tx.select().from(formations).where(eq(formations.id, formation.id));
            const { target: t } = await this.movement.split(tx, fresh, rowsNow, send);
            await tx.update(formations).set({ frontCountryId: target.id, restX: null, restY: null }).where(eq(formations.id, t.id));
            guards.push(t.id);
          } else {
            const r = await this.movement.orderFor(tx, country, campaignId, formation.id, idByKey.get(part.key)!, send, false, null, target.id);
            guards.push(r.formationId);
          }
          done.push(PROVINCE_BY_KEY[part.key]?.name ?? part.key);
        } catch {
          // no road to that province: those units stay where they are
        }
      }
      if (done.length === 0) throw new BadRequestException('No road leads from this army to that border');
      let n = 1;
      for (const id of new Set(guards)) {
        await tx.update(formations).set({ name: `${target.name} Front ${n++}` }).where(eq(formations.id, id));
      }
      return { assigned: done.length, provinces: done };
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'move' });
    return { ok: true, ...result };
  }

  /** Scheduler hook: armies on a front whose country is at war move into the next enemy province next to them. */
  async processDue(): Promise<void> {
    if (Date.now() - this.lastRun < 4000) return;
    this.lastRun = Date.now();
    const rows = await this.db
      .select()
      .from(formations)
      .where(and(isNotNull(formations.frontCountryId), isNull(formations.moveArrivesAt), eq(formations.patrolActive, false), isNull(formations.seaNode)))
      .limit(300);
    if (rows.length === 0) return;

    const provCache = new Map<string, { idByKey: Map<string, string>; keyById: Map<string, string>; owner: Map<string, string> }>();
    const warCache = new Map<string, Set<string>>();
    const claimed = new Map<string, Set<string>>();
    for (const f of rows) {
      try {
        let wars = warCache.get(f.countryId);
        if (!wars) warCache.set(f.countryId, (wars = await this.wars.enemiesOf(this.db, f.countryId)));
        if (!wars.has(f.frontCountryId!)) continue;
        let pc = provCache.get(f.campaignId);
        if (!pc) {
          const ps = await this.db
            .select({ id: provinces.id, key: provinces.key, owner: provinces.ownerCountryId })
            .from(provinces)
            .where(eq(provinces.campaignId, f.campaignId));
          pc = { idByKey: new Map(ps.map((p) => [p.key, p.id])), keyById: new Map(ps.map((p) => [p.id, p.key])), owner: new Map(ps.map((p) => [p.key, p.owner])) };
          provCache.set(f.campaignId, pc);
        }
        const here = pc.keyById.get(f.provinceId);
        const geo = here ? PROVINCE_BY_KEY[here] : undefined;
        if (!geo) continue;
        const taken = claimed.get(f.countryId) ?? new Set<string>();
        claimed.set(f.countryId, taken);
        const options = geo.roads.filter((k) => pc!.owner.get(k) === f.frontCountryId && !taken.has(k));
        if (options.length === 0) continue;
        // cities and capitals first: they are what the war is for
        options.sort((a, b) => Number(!!PROVINCE_BY_KEY[b]?.isCity || !!PROVINCE_BY_KEY[b]?.isCapital) - Number(!!PROVINCE_BY_KEY[a]?.isCity || !!PROVINCE_BY_KEY[a]?.isCapital));
        const pick = options[0];
        taken.add(pick);
        await this.economy.lock(f.countryId, (tx, country) =>
          this.movement.orderFor(tx, country, f.campaignId, f.id, pc!.idByKey.get(pick)!, undefined, false, null, f.frontCountryId),
        );
        this.realtime.campaignUpdate(f.campaignId, { kind: 'move' });
      } catch (err) {
        this.log.warn(`front ${f.id}: ${(err as Error).message}`);
      }
    }
  }
}
