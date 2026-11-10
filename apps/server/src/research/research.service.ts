import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, lte } from 'drizzle-orm';
import {
  RESEARCH_CANCEL_REFUND,
  TECH_BY_ID,
  canAfford,
  researchSeconds,
  spend,
  addResources,
  type PartialResources,
} from '@cw/shared';
import { env } from '../config/env';
import { DB, Db } from '../db/db.module';
import { research } from '../db/schema';
import { EconomyService } from '../economy/economy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlayersService } from '../players/players.service';
import { RealtimeService } from '../realtime/realtime.service';
import { loadResearch } from './research.queries';

/**
 * One research project at a time per country. The price is paid at the start. Duration is fixed
 * when the project starts, from your laboratories and universities at that moment. There is no way
 * to pay for speed: the only speed-ups are buildings and techs, and they are capped.
 */
@Injectable()
export class ResearchService {
  private readonly log = new Logger(ResearchService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly economy: EconomyService,
    private readonly players: PlayersService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async start(userId: string, campaignId: string, techId: string) {
    const tech = TECH_BY_ID[techId];
    if (!tech) throw new NotFoundException('Unknown technology');
    const player = await this.players.require(userId, campaignId);

    const result = await this.economy.lock(player.countryId, async (tx, country) => {
      const info = await loadResearch(tx, country.id);
      if (info.done.includes(techId)) throw new BadRequestException('Already researched');
      if (info.active) throw new BadRequestException('Another project is already running. Finish or cancel it first.');
      const missing = tech.requires.filter((r) => !info.done.includes(r));
      if (missing.length) {
        throw new BadRequestException(`Requires: ${missing.map((m) => TECH_BY_ID[m]?.name ?? m).join(', ')}`);
      }

      const balance = await this.economy.settle(tx, country);
      if (!canAfford(balance, tech.cost)) throw new BadRequestException('Not enough resources');
      await this.economy.writeBalance(tx, country.id, spend(balance, tech.cost));

      const seconds = researchSeconds(tech.baseSeconds, info.summary.speedPercent, env.GAME_SPEED);
      const now = new Date();
      const completesAt = new Date(now.getTime() + seconds * 1000);
      await tx.insert(research).values({
        campaignId,
        countryId: country.id,
        techId,
        status: 'active',
        startedAt: now,
        completesAt,
      });
      return { completesAt: completesAt.toISOString(), speedPercent: info.summary.speedPercent };
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'research' });
    return { ok: true, ...result };
  }

  /** Cancel the running project. Half the price comes back; the time is lost. */
  async cancel(userId: string, campaignId: string) {
    const player = await this.players.require(userId, campaignId);
    await this.economy.lock(player.countryId, async (tx, country) => {
      const [running] = await tx
        .select()
        .from(research)
        .where(and(eq(research.countryId, country.id), eq(research.status, 'active')))
        .for('update');
      if (!running) throw new BadRequestException('Nothing is being researched');
      const cost = TECH_BY_ID[running.techId].cost;
      const refund: PartialResources = {};
      for (const [k, v] of Object.entries(cost)) refund[k as keyof PartialResources] = Math.floor((v ?? 0) * RESEARCH_CANCEL_REFUND);
      const balance = await this.economy.settle(tx, country);
      await this.economy.writeBalance(tx, country.id, addResources(balance, refund));
      await tx.delete(research).where(eq(research.id, running.id));
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'research' });
    return { ok: true };
  }

  /** Scheduler hook: finishes projects whose time is up, even if everyone was offline. */
  async processDue(): Promise<void> {
    const due = await this.db
      .select()
      .from(research)
      .where(and(eq(research.status, 'active'), lte(research.completesAt, new Date())))
      .limit(100);

    for (const r of due) {
      try {
        const note = await this.economy.lock(r.countryId, async (tx, country) => {
          const [fresh] = await tx.select().from(research).where(eq(research.id, r.id)).for('update');
          if (!fresh || fresh.status !== 'active') return null;
          // Settle first: the new tech can change this country's production.
          await this.economy.settle(tx, country);
          await tx.update(research).set({ status: 'done' }).where(eq(research.id, r.id));
          const tech = TECH_BY_ID[r.techId];
          return this.notifications.add(tx, {
            campaignId: country.campaignId,
            countryId: country.id,
            type: 'research_done',
            message: `Research complete: ${tech?.name ?? r.techId}.`,
          });
        });
        if (note) {
          this.notifications.publish(note);
          this.realtime.campaignUpdate(r.campaignId, { kind: 'research' });
        }
      } catch (err) {
        this.log.warn(`research ${r.id}: ${(err as Error).message}`);
      }
    }
  }
}
