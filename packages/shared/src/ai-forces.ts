import { UNITS } from './game-data/units';
import { PATROL_MAX_FLIGHT, patrolDistance, patrolRadius, provincesInCircle } from './patrol';
import { unitPower, type StackUnit } from './ai-war';
import type { UnitType } from './types';

/** The AI patrols only where the enemy has at least this much fighting power inside the circle (about three infantry). */
export const AI_PATROL_MIN_POWER = 3 * unitPower([{ unitType: 'infantry', count: 1 }]);
/** A fleet attacks only when it is this many times stronger than what it sees. */
export const AI_FLEET_RATIO = 1.3;

/**
 * Where should these aircraft patrol? The circle centre (within flying range of `baseKey`) that holds the most
 * enemy power, with a small discount for every enemy province in it (their air defence shoots back).
 * Null when nothing is worth flying to.
 */
export function planAiPatrol(input: {
  baseKey: string;
  units: StackUnit[];
  /** Enemy power standing in each province. */
  enemyPower: ReadonlyMap<string, number>;
  /** Provinces owned by countries we are at war with. */
  enemyProvinces: ReadonlySet<string>;
}): { centerKey: string; power: number } | null {
  const radius = patrolRadius(input.units);
  if (radius <= 0) return null;
  let best: { centerKey: string; power: number; score: number } | null = null;
  const candidates = new Set<string>();
  for (const key of input.enemyPower.keys()) candidates.add(key);
  for (const centre of candidates) {
    if (patrolDistance(input.baseKey, centre) > PATROL_MAX_FLIGHT) continue;
    const inside = provincesInCircle(centre, radius);
    let power = 0;
    let hostile = 0;
    for (const k of inside) {
      power += input.enemyPower.get(k) ?? 0;
      if (input.enemyProvinces.has(k)) hostile++;
    }
    const score = power * (1 - Math.min(0.5, 0.05 * hostile));
    if (power >= AI_PATROL_MIN_POWER && (!best || score > best.score)) best = { centerKey: centre, power, score };
  }
  return best ? { centerKey: best.centerKey, power: best.power } : null;
}

/** Should a patrol already in place be called off? Yes when the enemy has gone from its circle. */
export function aiPatrolWorthKeeping(centerKey: string, units: StackUnit[], enemyPower: ReadonlyMap<string, number>): boolean {
  const radius = patrolRadius(units);
  let power = 0;
  for (const k of provincesInCircle(centerKey, radius)) power += enemyPower.get(k) ?? 0;
  return power >= AI_PATROL_MIN_POWER / 2;
}

/** Picks the enemy fleet to hunt: the juiciest one we are clearly stronger than, or null. */
export function planAiFleetTarget(fleet: StackUnit[], enemies: { id: string; units: StackUnit[]; distance: number }[]): string | null {
  const mine = unitPower(fleet);
  let best: { id: string; value: number } | null = null;
  for (const e of enemies) {
    const theirs = unitPower(e.units);
    if (theirs <= 0 || mine < theirs * AI_FLEET_RATIO) continue;
    const value = theirs / (1 + e.distance / 4);
    if (!best || value > best.value) best = { id: e.id, value };
  }
  return best?.id ?? null;
}

export interface AiPurchaseInput {
  atWar: boolean;
  ownedProvinces: number;
  hasAirbase: boolean;
  hasHarbor: boolean;
  aircraft: number;
  ships: number;
}

/** How many aircraft / ships the AI keeps. Small on purpose: it should be a nuisance, not a juggernaut. */
export const aiAircraftCap = (owned: number) => Math.min(8, 2 + Math.ceil(owned / 2));
export const aiShipCap = (owned: number) => Math.min(6, 1 + Math.ceil(owned / 3));

/** At most this many units are bought per decision. The AI pays full price and ignores research. */
export function aiPurchases(i: AiPurchaseInput): { unitType: UnitType; count: number }[] {
  if (!i.atWar) return [];
  const out: { unitType: UnitType; count: number }[] = [];
  if (i.hasAirbase && i.aircraft < aiAircraftCap(i.ownedProvinces)) {
    out.push({ unitType: i.aircraft % 3 === 2 ? 'bomber' : 'fighter', count: 1 });
  }
  if (i.hasHarbor && i.ships < aiShipCap(i.ownedProvinces)) {
    out.push({ unitType: (['destroyer', 'corvette', 'submarine'] as const)[i.ships % 3], count: 1 });
  }
  return out;
}

export const isAirUnit = (t: UnitType) => UNITS[t].category === 'air';
export const isShipUnit = (t: UnitType) => UNITS[t].category === 'naval';
