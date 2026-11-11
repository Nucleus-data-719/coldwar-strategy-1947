import type { PartialResources } from '../types';

export type RelationStage = 'war' | 'allied' | 'friendly' | 'neutral' | 'unfriendly' | 'hostile';

export const OPINION_MIN = -100;
export const OPINION_MAX = 100;
/** Both sides must be at least this friendly for an alliance (AI countries check it themselves). */
export const ALLIANCE_MIN_OPINION = 25;
export const ALLIANCE_MAX = 3;
/** Game seconds between a defence call and the ally joining the war automatically. */
export const MOBILISATION_SECONDS = 2 * 3600;

/** Opinion changes, applied between the two countries involved. */
export const OPINION_EVENTS = {
  warDeclared: -60,
  allianceBroken: -30,
  callDeclined: -40,
  callHonoured: 20,
} as const;

/** What a resource gift is worth when it comes to winning someone over. */
export const ASSISTANCE_VALUE: PartialResources = { money: 1, food: 1, oil: 2, steel: 2, electronics: 4, rare: 5, wood: 1 };
export const ASSISTANCE_MIN_VALUE = 150;
/** Each full ASSISTANCE_VALUE_PER_POINT of value is one point of opinion, up to the cap per gift. */
export const ASSISTANCE_VALUE_PER_POINT = 150;
export const ASSISTANCE_MAX_POINTS = 10;
