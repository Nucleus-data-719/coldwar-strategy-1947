import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  GENERALS,
  GENERAL_ACTIVE_SECONDS,
  GENERAL_BY_ID,
  GENERAL_COOLDOWN_SECONDS,
  GENERAL_DISPATCH_SECONDS,
  GENERAL_FRAGMENTS_NEEDED,
  GENERAL_SLOTS,
  type GeneralsStateDto,
} from '@cw/shared';
import { env } from '../config/env';
import { DB, Db, DbOrTx } from '../db/db.module';
import { generalClaims, generals } from '../db/schema';
import { EconomyService } from '../economy/economy.service';
import { PlayersService } from '../players/players.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ensureRoster, formationOwnedBy, toGeneralDto } from './generals.queries';

@Injectable()
export class GeneralsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly economy: EconomyService,
    private readonly players: PlayersService,
    private readonly realtime: RealtimeService,
  ) {}

  async state(userId: string, campaignId: string): Promise<GeneralsStateDto> {
    const player = await this.players.require(userId, campaignId);
    await ensureRoster(this.db, campaignId, player.countryId);
    return this.stateFor(this.db, player.countryId);
  }

  private async stateFor(db: DbOrTx, countryId: string): Promise<GeneralsStateDto> {
    const rows = await db.select().from(generals).where(eq(generals.countryId, countryId));
    const [claim] = await db.select().from(generalClaims).where(eq(generalClaims.countryId, countryId));
    const next = claim ? new Date(claim.lastClaimAt.getTime() + (GENERAL_DISPATCH_SECONDS / env.GAME_SPEED) * 1000) : null;
    const order = new Map(GENERALS.map((g, i) => [g.id, i]));
    rows.sort((a, b) => (order.get(a.generalId) ?? 0) - (order.get(b.generalId) ?? 0));
    return {
      generals: rows.map(toGeneralDto),
      deployed: rows.filter((r) => r.deployedFormationId).length,
      slots: GENERAL_SLOTS,
      nextDispatchAt: next && next.getTime() > Date.now() ? next.toISOString() : null,
    };
  }

  /** Put a general in charge of one of your armies. Moving him from another army is allowed. */
  async deploy(userId: string, campaignId: string, generalId: string, formationId: string) {
    if (!GENERAL_BY_ID[generalId]) throw new NotFoundException('Unknown general');
    const player = await this.players.require(userId, campaignId);
    await this.economy.lock(player.countryId, async (tx, country) => {
      await ensureRoster(tx, campaignId, country.id);
      const [g] = await tx
        .select()
        .from(generals)
        .where(and(eq(generals.countryId, country.id), eq(generals.generalId, generalId)))
        .for('update');
      if (!g || !g.unlocked) throw new BadRequestException('You have not recruited this general yet');
      if (g.lockedUntil && g.lockedUntil.getTime() > Date.now()) {
        throw new BadRequestException('He was defeated recently and is recovering');
      }
      const f = await formationOwnedBy(tx, formationId, country.id);
      if (!f) throw new NotFoundException('Army not found');

      const rows = await tx.select().from(generals).where(eq(generals.countryId, country.id));
      const onArmy = rows.find((r) => r.deployedFormationId === formationId);
      if (onArmy && onArmy.id !== g.id) throw new BadRequestException('That army already has a general');
      const used = rows.filter((r) => r.deployedFormationId).length;
      if (!g.deployedFormationId && used >= GENERAL_SLOTS) {
        throw new BadRequestException(`All ${GENERAL_SLOTS} deployment slots are in use`);
      }
      await tx.update(generals).set({ deployedFormationId: formationId }).where(eq(generals.id, g.id));
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'generals' });
    return { ok: true };
  }

  async undeploy(userId: string, campaignId: string, generalId: string) {
    const player = await this.players.require(userId, campaignId);
    await this.db
      .update(generals)
      .set({ deployedFormationId: null })
      .where(and(eq(generals.countryId, player.countryId), eq(generals.generalId, generalId)));
    this.realtime.campaignUpdate(campaignId, { kind: 'generals' });
    return { ok: true };
  }

  /** Active ability: a bigger combat bonus for a short time, then a long cooldown. */
  async activate(userId: string, campaignId: string, generalId: string) {
    const player = await this.players.require(userId, campaignId);
    const result = await this.economy.lock(player.countryId, async (tx, country) => {
      const [g] = await tx
        .select()
        .from(generals)
        .where(and(eq(generals.countryId, country.id), eq(generals.generalId, generalId)))
        .for('update');
      if (!g || !g.unlocked) throw new NotFoundException('General not found');
      if (!g.deployedFormationId) throw new BadRequestException('Deploy him to an army first');
      const now = Date.now();
      if (g.abilityReadyAt && g.abilityReadyAt.getTime() > now) throw new BadRequestException('The ability is on cooldown');
      const until = new Date(now + (GENERAL_ACTIVE_SECONDS / env.GAME_SPEED) * 1000);
      const ready = new Date(now + (GENERAL_COOLDOWN_SECONDS / env.GAME_SPEED) * 1000);
      await tx.update(generals).set({ abilityActiveUntil: until, abilityReadyAt: ready }).where(eq(generals.id, g.id));
      return { activeUntil: until.toISOString() };
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'generals' });
    return { ok: true, ...result };
  }

  /**
   * Free recruitment fragment, once per interval. A stand-in for the mission rewards that arrive
   * in the missions update; it lets you collect the whole roster over time.
   */
  async dispatch(userId: string, campaignId: string) {
    const player = await this.players.require(userId, campaignId);
    const result = await this.economy.lock(player.countryId, async (tx, country) => {
      await ensureRoster(tx, campaignId, country.id);
      const [claim] = await tx.select().from(generalClaims).where(eq(generalClaims.countryId, country.id)).for('update');
      const wait = (GENERAL_DISPATCH_SECONDS / env.GAME_SPEED) * 1000;
      if (claim && claim.lastClaimAt.getTime() + wait > Date.now()) throw new BadRequestException('No new dispatch yet');

      const rows = await tx.select().from(generals).where(eq(generals.countryId, country.id));
      const locked = rows.filter((r) => !r.unlocked);
      if (locked.length === 0) throw new BadRequestException('You have recruited every general');
      const pick = locked[Math.floor(Math.random() * locked.length)];
      const def = GENERAL_BY_ID[pick.generalId];
      const fragments = pick.fragments + 1;
      const recruited = fragments >= GENERAL_FRAGMENTS_NEEDED[def.rarity];
      await tx.update(generals).set({ fragments, unlocked: recruited }).where(eq(generals.id, pick.id));
      await tx
        .insert(generalClaims)
        .values({ countryId: country.id, lastClaimAt: new Date() })
        .onConflictDoUpdate({ target: generalClaims.countryId, set: { lastClaimAt: new Date() } });
      return { generalId: pick.generalId, fragments, needed: GENERAL_FRAGMENTS_NEEDED[def.rarity], recruited };
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'generals' });
    return { ok: true, ...result };
  }
}
