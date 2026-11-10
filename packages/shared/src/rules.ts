import { BUILDINGS } from './game-data/buildings';
import { SUPPLY_PENALTY_PERCENT } from './game-data/constants';
import { UNITS } from './game-data/units';
import type {
  BuildingStatus,
  BuildingType,
  PartialResources,
  ResourceKey,
  Resources,
  UnitType,
} from './types';
import { RESOURCE_KEYS, RESOURCE_LABELS, emptyResources } from './types';

export interface BuildingLike {
  type: BuildingType;
  status: BuildingStatus;
}

export function addResources(a: Resources, b: PartialResources): Resources {
  const out = { ...a };
  for (const k of RESOURCE_KEYS) out[k] = a[k] + (b[k] ?? 0);
  return out;
}

/** Plain subtraction. May go negative (used for rates). */
export function subtractResources(a: Resources, b: PartialResources): Resources {
  const out = { ...a };
  for (const k of RESOURCE_KEYS) out[k] = a[k] - (b[k] ?? 0);
  return out;
}

export function canAfford(balance: Resources, cost: PartialResources): boolean {
  return RESOURCE_KEYS.every((k) => balance[k] >= (cost[k] ?? 0));
}

export function spend(balance: Resources, cost: PartialResources): Resources {
  return subtractResources(balance, cost);
}

/** Industry boosts these. Food and manpower come from the land and its people, not from factories. */
export const INDUSTRIAL_RESOURCES: ResourceKey[] = ['money', 'oil', 'steel', 'electronics', 'rare'];

/** Hourly production of one province, including completed buildings. */
export function provinceProduction(base: Resources, buildings: BuildingLike[]): Resources {
  let multiplier = 1;
  for (const b of buildings) {
    if (b.status === 'complete') multiplier += BUILDINGS[b.type].productionBonus ?? 0;
  }
  const out = emptyResources();
  for (const k of RESOURCE_KEYS) out[k] = INDUSTRIAL_RESOURCES.includes(k) ? base[k] * multiplier : base[k];
  return out;
}

/** Hourly upkeep of a set of units. */
export function unitUpkeepPerHour(units: { unitType: UnitType; count: number }[]): Resources {
  let out = emptyResources();
  for (const u of units) {
    const def = UNITS[u.unitType];
    for (const k of RESOURCE_KEYS) out[k] += (def.upkeep[k] ?? 0) * u.count;
  }
  return out;
}

/** Applies hourly rates over elapsed game seconds. Balances never drop below zero. */
export function applyRates(
  balance: Resources,
  ratesPerHour: Resources,
  elapsedGameSeconds: number,
): Resources {
  const hours = Math.max(0, elapsedGameSeconds) / 3600;
  const out = { ...balance };
  for (const k of RESOURCE_KEYS) out[k] = Math.max(0, balance[k] + ratesPerHour[k] * hours);
  return out;
}

/** Real-time seconds for a base duration at the given game speed. */
export function scaleSeconds(baseSeconds: number, gameSpeed: number): number {
  return Math.max(1, Math.round(baseSeconds / gameSpeed));
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** Resources that are at zero and still being used up: the country is short of them. */
export function shortagesOf(balance: Resources, ratesPerHour: Resources): ResourceKey[] {
  return RESOURCE_KEYS.filter((k) => balance[k] < 0.5 && ratesPerHour[k] < 0);
}

/** Battle penalties for the given shortages, as modifiers with negative percent. */
export function supplyPenalty(shortages: ResourceKey[]): { label: string; percent: number }[] {
  return shortages
    .filter((k) => SUPPLY_PENALTY_PERCENT[k])
    .map((k) => ({ label: `Out of ${RESOURCE_LABELS[k].toLowerCase()}`, percent: -(SUPPLY_PENALTY_PERCENT[k] ?? 0) }));
}
