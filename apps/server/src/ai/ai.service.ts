import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import {
  AI_MONEY_RESERVE,
  BUILDINGS,
  BUILDING_TYPES,
  canAfford,
  scaleSeconds,
  type BuildingType,
} from '@cw/shared';
import { env } from '../config/env';
import { DB, Db } from '../db/db.module';
import { buildings, campaigns, countries, provinces } from '../db/schema';
import { BuildingsService } from '../buildings/buildings.service';
import { EconomyService } from '../economy/economy.service';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Simple economic AI. It runs per country on a timer (not every tick), keeps a money
 * reserve, and builds in a fixed priority order: capital recruitment, local factories
 * on the richest provinces, recruitment centers on a third of provinces, capital fortress.
 */
@Injectable()
export class AiService {
  private readonly log = new Logger(AiService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly economy: EconomyService,
    private readonly buildingsService: BuildingsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Processes every AI country whose decision time has come. */
  async runDue(): Promise<void> {
    const now = new Date();
    const due = await this.db
      .select({ id: countries.id, campaignId: countries.campaignId })
      .from(countries)
      .innerJoin(campaigns, eq(campaigns.id, countries.campaignId))
      .where(
        and(
          eq(countries.aiControlled, true),
          eq(campaigns.status, 'active'),
          or(isNull(countries.aiNextDecisionAt), lte(countries.aiNextDecisionAt, now)),
        ),
      )
      .limit(50);

    for (const c of due) {
      try {
        const changed = await this.decide(c.id);
        if (changed) this.realtime.campaignUpdate(c.campaignId, { kind: 'ai' });
      } catch (err) {
        this.log.warn(`AI decision failed for ${c.id}: ${(err as Error).message}`);
      } finally {
        // Always schedule the next decision, so a persistent error cannot spin every tick.
        const nextMs = Math.max(5, env.AI_INTERVAL_SECONDS / env.GAME_SPEED) * 1000;
        await this.db
          .update(countries)
          .set({ aiNextDecisionAt: new Date(Date.now() + nextMs) })
          .where(eq(countries.id, c.id));
      }
    }
  }

  /** Returns true if the AI started any construction. */
  private async decide(countryId: string): Promise<boolean> {
    return this.economy.lock(countryId, async (tx, country) => {
      if (!country.aiControlled) return false;
      let balance = await this.economy.settle(tx, country);

      const owned = await tx.select().from(provinces).where(eq(provinces.ownerCountryId, countryId));
      if (owned.length === 0) return false;
      const blds = await tx
        .select()
        .from(buildings)
        .where(
          inArray(
            buildings.provinceId,
            owned.map((p) => p.id),
          ),
        );

      const typesIn = new Map<string, Set<BuildingType>>();
      for (const b of blds) {
        const set = typesIn.get(b.provinceId) ?? new Set<BuildingType>();
        set.add(b.type);
        typesIn.set(b.provinceId, set);
      }
      const score = (p: (typeof owned)[number]) =>
        p.production.money + p.production.food + p.production.steel * 2 + p.production.oil * 2;
      const richest = [...owned].sort((a, b) => score(b) - score(a));
      const capital = owned.find((p) => p.id === country.capitalProvinceId);

      const wanted: { provinceId: string; type: BuildingType }[] = [];
      const add = (p: (typeof owned)[number] | undefined, type: BuildingType) => {
        if (!p) return;
        if ((BUILDING_TYPES as readonly string[]).indexOf(type) === -1) return;
        const have = typesIn.get(p.id) ?? new Set<BuildingType>();
        if (have.has(type)) return;
        if (have.size >= p.buildingSlots) return;
        if (BUILDINGS[type].requiresCoastal && !p.isCoastal) return;
        wanted.push({ provinceId: p.id, type });
      };

      add(capital, 'recruitment_center');
      add(capital, 'local_factory');
      for (const p of richest) add(p, 'local_factory');
      const centersTarget = Math.ceil(owned.length / 3);
      let centers = blds.filter((b) => b.type === 'recruitment_center').length;
      for (const p of richest) {
        if (centers >= centersTarget) break;
        if (!(typesIn.get(p.id) ?? new Set()).has('recruitment_center')) {
          add(p, 'recruitment_center');
          centers++;
        }
      }
      add(capital, 'fortress');

      let started = 0;
      for (const w of wanted) {
        if (started >= 2) break;
        const def = BUILDINGS[w.type];
        const afterMoney = balance.money - (def.cost.money ?? 0);
        if (!canAfford(balance, def.cost) || afterMoney < AI_MONEY_RESERVE) continue;
        const result = await this.buildingsService.constructLocked(tx, country, balance, w.provinceId, w.type);
        balance = result.balance;
        // Keep the local view consistent so we do not pick the same slot twice.
        const set = typesIn.get(w.provinceId) ?? new Set<BuildingType>();
        set.add(w.type);
        typesIn.set(w.provinceId, set);
        started++;
      }
      return started > 0;
    });
  }
}
