import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, isNotNull, isNull, lt, lte } from 'drizzle-orm';
import {
  BUILDINGS,
  GARRISON_NAME,
  RECRUIT_UNIT,
  UNITS,
  canAfford,
  scaleSeconds,
  spend,
} from '@cw/shared';
import { env } from '../config/env';
import { DB, Db } from '../db/db.module';
import {
  buildings,
  countries,
  formationUnits,
  formations,
  players,
  provinces,
  users,
  NotificationRow,
} from '../db/schema';
import { AiService } from '../ai/ai.service';
import { DiplomacyService } from '../diplomacy/diplomacy.service';
import { ResearchService } from '../research/research.service';
import { CapitalService } from '../capital/capital.service';
import { ProductionService } from '../production/production.service';
import { MovementService } from '../military/movement.service';
import { PatrolService } from '../military/patrol.service';
import { NavalService } from '../military/naval.service';
import { EconomyService } from '../economy/economy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Server-side game clock. Every TICK_MS it looks in Postgres for things whose stored
 * timestamp has passed (construction, recruitment, AI turns, inactive players).
 * All progress lives in the database, so nothing is lost on restart or while offline.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SchedulerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly economy: EconomyService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly ai: AiService,
    private readonly movement: MovementService,
    private readonly patrols: PatrolService,
    private readonly naval: NavalService,
    private readonly production: ProductionService,
    private readonly capital: CapitalService,
    private readonly research: ResearchService,
    private readonly diplomacy: DiplomacyService,
  ) {}

  onModuleInit() {
    if (!env.SCHEDULER_ENABLED) {
      this.log.warn('Scheduler disabled (SCHEDULER_ENABLED=false)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), env.TICK_MS);
    this.log.log(`Scheduler started (every ${env.TICK_MS} ms)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.completeBuildings();
      await this.movement.processDue();
      await this.patrols.processDue();
      await this.naval.processDue();
      await this.endDisruptions();
      await this.production.processDue();
      await this.capital.processDue();
      await this.research.processDue();
      await this.diplomacy.processDue();
      await this.autoRecruit();
      await this.handleInactivity();
      await this.ai.runDue();
    } catch (err) {
      this.log.error(`Tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Captured provinces start producing again once their occupation period is over. */
  private async endDisruptions() {
    const due = await this.db
      .select({ id: provinces.id, ownerId: provinces.ownerCountryId, campaignId: provinces.campaignId })
      .from(provinces)
      .where(and(isNotNull(provinces.disruptedUntil), lte(provinces.disruptedUntil, new Date())))
      .limit(100);

    for (const d of due) {
      try {
        await this.economy.lock(d.ownerId, async (tx, country) => {
          const [fresh] = await tx.select().from(provinces).where(eq(provinces.id, d.id)).for('update');
          if (!fresh || fresh.ownerCountryId !== country.id || !fresh.disruptedUntil || fresh.disruptedUntil > new Date()) return;
          // Settle while the province is still counted as disrupted, then let it produce.
          await this.economy.settle(tx, country);
          await tx.update(provinces).set({ disruptedUntil: null }).where(eq(provinces.id, d.id));
        });
        this.realtime.campaignUpdate(d.campaignId, { kind: 'province', provinceId: d.id });
      } catch (err) {
        this.log.warn(`endDisruptions ${d.id}: ${(err as Error).message}`);
      }
    }
  }

  private async completeBuildings() {
    const due = await this.db
      .select({ id: buildings.id })
      .from(buildings)
      .where(and(eq(buildings.status, 'constructing'), lte(buildings.completesAt, new Date())))
      .limit(100);

    for (const { id } of due) {
      const [row] = await this.db
        .select({ b: buildings, p: provinces })
        .from(buildings)
        .innerJoin(provinces, eq(provinces.id, buildings.provinceId))
        .where(eq(buildings.id, id));
      if (!row) continue;
      const def = BUILDINGS[row.b.type];

      try {
        const note = await this.economy.lock(row.p.ownerCountryId, async (tx, country) => {
          const [fresh] = await tx.select().from(buildings).where(eq(buildings.id, id)).for('update');
          if (!fresh || fresh.status !== 'constructing') return null;
          // Settle first: the building changes this country's production rates.
          await this.economy.settle(tx, country);
          const nextActionAt = def.recruitIntervalSeconds
            ? new Date(Date.now() + scaleSeconds(def.recruitIntervalSeconds, env.GAME_SPEED) * 1000)
            : null;
          await tx.update(buildings).set({ status: 'complete', nextActionAt }).where(eq(buildings.id, id));
          return this.notifications.add(tx, {
            campaignId: country.campaignId,
            countryId: country.id,
            type: 'building_complete',
            message: `${def.name} in ${row.p.name} is complete.`,
          });
        });
        if (note) {
          this.notifications.publish(note);
          this.realtime.campaignUpdate(row.b.campaignId, { kind: 'building', provinceId: row.p.id });
        }
      } catch (err) {
        this.log.warn(`completeBuildings ${id}: ${(err as Error).message}`);
      }
    }
  }

  /** Every completed recruitment center trains one infantry per interval if affordable. */
  private async autoRecruit() {
    const due = await this.db
      .select({ id: buildings.id })
      .from(buildings)
      .where(
        and(
          eq(buildings.type, 'recruitment_center'),
          eq(buildings.status, 'complete'),
          lte(buildings.nextActionAt, new Date()),
        ),
      )
      .limit(200);

    const unit = UNITS[RECRUIT_UNIT];
    const intervalMs = scaleSeconds(BUILDINGS.recruitment_center.recruitIntervalSeconds!, env.GAME_SPEED) * 1000;

    for (const { id } of due) {
      const [row] = await this.db
        .select({ b: buildings, p: provinces })
        .from(buildings)
        .innerJoin(provinces, eq(provinces.id, buildings.provinceId))
        .where(eq(buildings.id, id));
      if (!row) continue;

      try {
        const note = await this.economy.lock(row.p.ownerCountryId, async (tx, country) => {
          const [fresh] = await tx.select().from(buildings).where(eq(buildings.id, id)).for('update');
          if (!fresh || fresh.status !== 'complete' || !fresh.nextActionAt || fresh.nextActionAt > new Date()) {
            return null;
          }
          const balance = await this.economy.settle(tx, country);
          await tx
            .update(buildings)
            .set({ nextActionAt: new Date(Date.now() + intervalMs) })
            .where(eq(buildings.id, id));
          if (!canAfford(balance, unit.cost)) return null; // try again next interval

          await this.economy.writeBalance(tx, country.id, spend(balance, unit.cost));

          const [existing] = await tx
            .select()
            .from(formations)
            .where(
              and(
                eq(formations.provinceId, row.p.id),
                eq(formations.countryId, country.id),
                eq(formations.name, GARRISON_NAME),
                isNull(formations.moveArrivesAt),
              ),
            );
          const formationId =
            existing?.id ??
            (
              await tx
                .insert(formations)
                .values({
                  campaignId: country.campaignId,
                  countryId: country.id,
                  provinceId: row.p.id,
                  name: GARRISON_NAME,
                })
                .returning()
            )[0].id;

          const [unitRow] = await tx
            .select()
            .from(formationUnits)
            .where(and(eq(formationUnits.formationId, formationId), eq(formationUnits.unitType, RECRUIT_UNIT)));
          if (unitRow) {
            await tx
              .update(formationUnits)
              .set({ count: unitRow.count + 1 })
              .where(eq(formationUnits.id, unitRow.id));
          } else {
            await tx.insert(formationUnits).values({ formationId, unitType: RECRUIT_UNIT, count: 1 });
          }

          return this.notifications.add(tx, {
            campaignId: country.campaignId,
            countryId: country.id,
            type: 'recruited',
            message: `${unit.name} recruited in ${row.p.name}.`,
          });
        });
        if (note) {
          this.notifications.publish(note);
          this.realtime.campaignUpdate(row.b.campaignId, { kind: 'recruit', provinceId: row.p.id });
        }
      } catch (err) {
        this.log.warn(`autoRecruit ${id}: ${(err as Error).message}`);
      }
    }
  }

  /** Hands countries of long-absent players to the AI. They get control back on their next visit. */
  private async handleInactivity() {
    const threshold = new Date(Date.now() - env.INACTIVITY_HOURS * 3600 * 1000);
    const rows = await this.db
      .select({ countryId: players.countryId, campaignId: players.campaignId })
      .from(players)
      .innerJoin(users, eq(users.id, players.userId))
      .innerJoin(countries, eq(countries.id, players.countryId))
      .where(and(lt(users.lastSeenAt, threshold), eq(countries.aiControlled, false)));

    for (const r of rows) {
      const note: NotificationRow = await this.db.transaction(async (tx) => {
        await tx
          .update(countries)
          .set({ aiControlled: true, aiNextDecisionAt: new Date() })
          .where(eq(countries.id, r.countryId));
        return this.notifications.add(tx, {
          campaignId: r.campaignId,
          countryId: r.countryId,
          type: 'ai_takeover',
          message: `You were away for over ${env.INACTIVITY_HOURS} hours. The AI is running your country until you return.`,
        });
      });
      this.notifications.publish(note);
      this.realtime.campaignUpdate(r.campaignId, { kind: 'ai_takeover' });
      this.log.log(`AI took over country ${r.countryId} (player inactive)`);
    }
  }
}
