import type { BattleModifier } from './combat';
import {
  GENERAL_ACTIVE_PERCENT,
  GENERAL_BY_ID,
  GENERAL_CATEGORIES,
  GENERAL_LEVEL_BONUS,
  GENERAL_LEVEL_XP,
  GENERAL_PASSIVE_PERCENT,
  type GeneralDef,
} from './game-data/generals';
import type { UnitType } from './types';

export function generalLevel(xp: number): number {
  let level = 1;
  for (let i = 0; i < GENERAL_LEVEL_XP.length; i++) if (xp >= GENERAL_LEVEL_XP[i]) level = i + 1;
  return level;
}

/** XP still needed for the next level, or null at the top level. */
export function xpToNextLevel(xp: number): number | null {
  const level = generalLevel(xp);
  return level >= GENERAL_LEVEL_XP.length ? null : GENERAL_LEVEL_XP[level] - xp;
}

export const generalPassivePercent = (def: GeneralDef, level: number) =>
  GENERAL_PASSIVE_PERCENT[def.rarity] + (level - 1) * GENERAL_LEVEL_BONUS;

export const generalActivePercent = (def: GeneralDef) => GENERAL_ACTIVE_PERCENT[def.rarity];

export const abilityName = (def: GeneralDef) => GENERAL_CATEGORIES.find((c) => c.id === def.category)!.ability;

/** A general only helps an army that contains the kind of units he is known for. */
export function generalApplies(def: GeneralDef, units: { unitType: UnitType; count: number }[]): boolean {
  const cat = GENERAL_CATEGORIES.find((c) => c.id === def.category)!;
  if (cat.units === 'all') return units.some((u) => u.count > 0);
  const list = cat.units;
  return units.some((u) => u.count > 0 && list.includes(u.unitType));
}

export interface DeployedGeneral {
  generalId: string;
  xp: number;
  /** ms timestamp until which the active ability runs, or null. */
  abilityActiveUntil: number | null;
  /** The units of the army he leads. */
  units: { unitType: UnitType; count: number }[];
}

/** Battle modifiers for one side from its deployed generals. */
export function generalModifiers(side: 'attacker' | 'defender', generals: DeployedGeneral[], atMs: number): BattleModifier[] {
  const out: BattleModifier[] = [];
  for (const g of generals) {
    const def = GENERAL_BY_ID[g.generalId];
    if (!def || !generalApplies(def, g.units)) continue;
    out.push({ side, label: `${def.name} (level ${generalLevel(g.xp)})`, percent: generalPassivePercent(def, generalLevel(g.xp)) });
    if (g.abilityActiveUntil !== null && g.abilityActiveUntil > atMs) {
      out.push({ side, label: `${def.name}: ${abilityName(def)}`, percent: generalActivePercent(def) });
    }
  }
  return out;
}
