import {
  ASSISTANCE_MAX_POINTS,
  ASSISTANCE_VALUE,
  ASSISTANCE_VALUE_PER_POINT,
  OPINION_MAX,
  OPINION_MIN,
  type RelationStage,
} from './game-data/diplomacy';
import { RESOURCE_KEYS, type PartialResources } from './types';

export const clampOpinion = (n: number) => Math.max(OPINION_MIN, Math.min(OPINION_MAX, Math.round(n)));

export function relationStage(opinion: number, atWar: boolean, allied: boolean): RelationStage {
  if (atWar) return 'war';
  if (allied) return 'allied';
  if (opinion >= 25) return 'friendly';
  if (opinion > -25) return 'neutral';
  if (opinion > -60) return 'unfriendly';
  return 'hostile';
}

/** Gift value used for the minimum and for opinion. Manpower cannot be given. */
export function assistanceValue(gift: PartialResources): number {
  let v = 0;
  for (const k of RESOURCE_KEYS) v += (gift[k] ?? 0) * (ASSISTANCE_VALUE[k] ?? 0);
  return v;
}

export function assistanceOpinion(gift: PartialResources): number {
  return Math.min(ASSISTANCE_MAX_POINTS, Math.floor(assistanceValue(gift) / ASSISTANCE_VALUE_PER_POINT));
}

/** Stable key for an unordered pair of country ids. */
export function pairOf(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Which allies of the attacked country get a call to war. Allies who are already fighting the
 * aggressor, are allied with the aggressor, or are the aggressor are skipped.
 */
export function countriesToCall(allies: string[], aggressorId: string, aggressorAllies: string[], alreadyAtWar: string[]): string[] {
  return allies.filter((a) => a !== aggressorId && !aggressorAllies.includes(a) && !alreadyAtWar.includes(a));
}
