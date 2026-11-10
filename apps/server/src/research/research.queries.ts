import { and, eq, inArray } from 'drizzle-orm';
import { summariseResearch, type ResearchStateDto, type ResearchSummary } from '@cw/shared';
import type { DbOrTx } from '../db/db.module';
import { buildings, provinces, research } from '../db/schema';

export interface ResearchInfo {
  done: string[];
  active: { techId: string; startedAt: Date; completesAt: Date } | null;
  summary: ResearchSummary;
}

/** A country's finished techs, the running project, and what they add up to. */
export async function loadResearch(db: DbOrTx, countryId: string): Promise<ResearchInfo> {
  const rows = await db.select().from(research).where(eq(research.countryId, countryId));
  const done = rows.filter((r) => r.status === 'done').map((r) => r.techId);
  const running = rows.find((r) => r.status === 'active');

  // Laboratories and universities count only in provinces you hold and that are not occupied.
  const owned = await db
    .select({ id: provinces.id, disruptedUntil: provinces.disruptedUntil })
    .from(provinces)
    .where(eq(provinces.ownerCountryId, countryId));
  const usable = owned.filter((p) => !p.disruptedUntil).map((p) => p.id);
  let labs = 0;
  let universities = 0;
  if (usable.length > 0) {
    const sites = await db
      .select({ type: buildings.type })
      .from(buildings)
      .where(
        and(inArray(buildings.provinceId, usable), inArray(buildings.type, ['research_lab', 'university']), eq(buildings.status, 'complete')),
      );
    labs = sites.filter((b) => b.type === 'research_lab').length;
    universities = sites.filter((b) => b.type === 'university').length;
  }

  return {
    done,
    active: running ? { techId: running.techId, startedAt: running.startedAt, completesAt: running.completesAt } : null,
    summary: summariseResearch(done, labs, universities),
  };
}

export function toResearchDto(info: ResearchInfo): ResearchStateDto {
  return {
    done: info.done,
    active: info.active
      ? {
          techId: info.active.techId,
          startedAt: info.active.startedAt.toISOString(),
          completesAt: info.active.completesAt.toISOString(),
        }
      : null,
    labs: info.summary.labs,
    universities: info.summary.universities,
    speedPercent: info.summary.speedPercent,
    rawSpeedPercent: info.summary.rawSpeedPercent,
    productionPercent: info.summary.productionPercent,
    combatPercent: info.summary.combatPercent,
    unlockedUnits: info.summary.unlockedUnits,
  };
}
