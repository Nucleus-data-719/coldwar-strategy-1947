import { RESEARCH_LAB_BONUS, RESEARCH_SPEED_CAP, TECH_BY_ID, BASE_UNLOCKED_UNITS, UNIVERSITY_BONUS } from './game-data/research';
import type { UnitType } from './types';

export interface ResearchSummary {
  labs: number;
  universities: number;
  /** Total research speed bonus after the cap, in percent. */
  speedPercent: number;
  /** Speed bonus before the cap, so the screen can show when the cap bites. */
  rawSpeedPercent: number;
  productionPercent: number;
  combatPercent: number;
  unlockedUnits: UnitType[];
}

/** Everything a country's finished research and science buildings add up to. */
export function summariseResearch(doneTechIds: Iterable<string>, labs: number, universities: number): ResearchSummary {
  let production = 0;
  let combat = 0;
  let techSpeed = 0;
  const unlocked = new Set<UnitType>(BASE_UNLOCKED_UNITS);
  for (const id of doneTechIds) {
    const t = TECH_BY_ID[id];
    if (!t) continue;
    production += t.effect.productionPercent ?? 0;
    combat += t.effect.combatPercent ?? 0;
    techSpeed += t.effect.researchSpeedPercent ?? 0;
    for (const u of t.effect.unlock ?? []) unlocked.add(u);
  }
  const raw = labs * RESEARCH_LAB_BONUS + universities * UNIVERSITY_BONUS + techSpeed;
  return {
    labs,
    universities,
    rawSpeedPercent: raw,
    speedPercent: Math.min(RESEARCH_SPEED_CAP, raw),
    productionPercent: production,
    combatPercent: combat,
    unlockedUnits: [...unlocked],
  };
}

/** Real seconds a project takes at the given research speed and game speed. */
export function researchSeconds(baseSeconds: number, speedPercent: number, gameSpeed: number): number {
  return Math.max(1, Math.round(baseSeconds / (1 + speedPercent / 100) / gameSpeed));
}
