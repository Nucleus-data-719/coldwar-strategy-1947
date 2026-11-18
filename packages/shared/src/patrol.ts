import { UNITS } from './game-data/units';
import { AIR_FERRY_FACTOR } from './game-data/era';
import { KM_PER_MAP_UNIT, provinceKm } from './geo';
import { moveHours } from './movement';
import { PROVINCES, PROVINCE_BY_KEY } from './map-data';
import type { UnitType } from './types';

type Units = readonly { unitType: UnitType; count: number }[];

/** Radius of the area a patrol covers, in map units (from each aircraft's patrolKm). */
export const PATROL_RADIUS: Partial<Record<UnitType, number>> = Object.fromEntries(
  Object.values(UNITS)
    .filter((u) => u.patrolKm)
    .map((u) => [u.type, Math.round(u.patrolKm! / KM_PER_MAP_UNIT)]),
);
/** Patrol effects are applied in steps of this many game hours. */
export const PATROL_STEP_HOURS = 1;
/** Most steps settled in one go (so a long outage does not wipe out everything at once). */
export const PATROL_MAX_STEPS = 24;
/** Buildings at or above this damage (percent) stop working until repaired. */
export const BUILDING_KNOCKED_OUT = 50;
/** Percent of damage a building repairs per game hour when it is not being bombed. */
export const BUILDING_REPAIR_PER_HOUR = 1;

export const isAirFormation = (units: Units): boolean =>
  units.some((u) => u.count > 0) && units.every((u) => u.count <= 0 || UNITS[u.unitType].category === 'air');

/** A mixed force patrols the area its shortest-ranged aircraft can cover, in map units. 0 when it is not an air force. */
export function patrolRadius(units: Units): number {
  if (!isAirFormation(units)) return 0;
  let r = Infinity;
  for (const u of units) if (u.count > 0) r = Math.min(r, PATROL_RADIUS[u.unitType] ?? 40);
  return Number.isFinite(r) ? r : 0;
}

/** Combat radius of an air force in km: its shortest-ranged aircraft. 0 when it has no aircraft. */
export function airRadiusKm(units: Units): number {
  let r = Infinity;
  for (const u of units) if (u.count > 0 && UNITS[u.unitType].rangeKm) r = Math.min(r, UNITS[u.unitType].rangeKm!);
  return Number.isFinite(r) ? r : 0;
}

/** Keys of every province whose centre lies inside the patrol circle (the patrol province itself included). */
export function provincesInCircle(centerKey: string, radius: number): string[] {
  const c = PROVINCE_BY_KEY[centerKey];
  if (!c) return [];
  return PROVINCES.filter((p) => Math.hypot(p.center.x - c.center.x, p.center.y - c.center.y) <= radius).map((p) => p.key);
}

/** Real seconds to fly straight from one province to another at `speed` km/h. */
export function patrolFlightSeconds(fromKey: string, toKey: string, speed: number, gameSpeed: number): number {
  return Math.max(1, Math.round((moveHours(provinceKm(fromKey, toKey), speed) * 3600) / gameSpeed));
}
/** Straight-line distance between two provinces in km. */
export const patrolDistance = (fromKey: string, toKey: string): number => provinceKm(fromKey, toKey);

/** The airbase of yours closest to `fromKey` (itself when it is one), or null when you have none. */
export function nearestAirbase(
  fromKey: string,
  countryId: string,
  ownerByKey: ReadonlyMap<string, string>,
  airbaseKeys: ReadonlySet<string>,
): string | null {
  let best: string | null = null;
  let bestKm = Infinity;
  for (const k of airbaseKeys) {
    if (ownerByKey.get(k) !== countryId) continue;
    const km = k === fromKey ? 0 : provinceKm(fromKey, k);
    if (km < bestKm) { bestKm = km; best = k; }
  }
  return best;
}

export type AirOrderKind = 'strike' | 'rebase' | 'patrol';

export interface AirOrderCheck {
  kind: AirOrderKind;
  fromKey: string;
  toKey: string;
  units: Units;
  countryId: string;
  ownerByKey: ReadonlyMap<string, string>;
  /** Provinces with a working airbase (any owner). */
  airbaseKeys: ReadonlySet<string>;
}

/**
 * 1950s air rules, shared by server and browser. Aircraft fly from airbases: strikes and patrols must lie
 * within their combat radius of your nearest airbase (where they are when you have none). Rebasing goes only
 * to an airbase of yours, within the ferry range (AIR_FERRY_FACTOR times the radius) of where they are now.
 * Returns why the order is not allowed, or null.
 */
export function airOrderProblem(c: AirOrderCheck): string | null {
  const radius = airRadiusKm(c.units);
  if (radius <= 0) return 'These units have no aircraft.';
  if (c.kind === 'rebase') {
    if (c.ownerByKey.get(c.toKey) !== c.countryId || !c.airbaseKeys.has(c.toKey)) return 'Aircraft can only be based at one of your own airbases.';
    const km = provinceKm(c.fromKey, c.toKey);
    const ferry = radius * AIR_FERRY_FACTOR;
    return km > ferry ? `Too far to ferry: ${Math.round(km)} km, these aircraft can ferry ${Math.round(ferry)} km. Rebase in shorter hops.` : null;
  }
  const base = nearestAirbase(c.fromKey, c.countryId, c.ownerByKey, c.airbaseKeys) ?? c.fromKey;
  const km = provinceKm(base, c.toKey);
  if (km > radius) {
    const name = PROVINCE_BY_KEY[base]?.name ?? 'their base';
    return `Out of range: ${Math.round(km)} km from the airbase at ${name}, combat radius ${Math.round(radius)} km. Build or move to an airbase closer to the target.`;
  }
  return null;
}

/** How much each aircraft type hurts armies and buildings on the ground. */
const GROUND_WEIGHT: Partial<Record<UnitType, number>> = { fighter: 0.25, air_support: 0.8, bomber: 1 };
const BUILDING_WEIGHT: Partial<Record<UnitType, number>> = { fighter: 0, air_support: 0.4, bomber: 1 };
const sum = (units: Units, w: Partial<Record<UnitType, number>>) =>
  units.reduce((s, u) => s + u.count * UNITS[u.unitType].attack * (w[u.unitType] ?? 0), 0);

/** Fighting strength in the air: fighters count fully, other aircraft only a little. */
export const airPower = (units: Units): number => sum(units, { fighter: 1, air_support: 0.4, bomber: 0.4 });

export interface PatrolSituation {
  /** Land and naval units of countries you are at war with, inside the circle. */
  enemyGroundUnits: number;
  /** How many enemy armies stand in the circle: the bombing is spread over them. */
  enemyArmies: number;
  /** Provinces in the circle owned by countries you are at war with (their air defence fires on you). */
  enemyProvinces: number;
  /** Their aircraft inside the circle. */
  enemyAirPower: number;
  /** Finished buildings of countries you are at war with, inside the circle. */
  enemyBuildings: number;
}

export interface PatrolHour {
  /** Share of each enemy army inside the circle lost per game hour. */
  groundLossPct: number;
  /** Damage points (0-100) each enemy building takes per game hour. */
  buildingPoints: number;
  /** Share of the patrolling aircraft lost per game hour (air defence and dogfights). */
  ownLossPct: number;
  /** Share of enemy aircraft in the circle lost per game hour. */
  enemyAirLossPct: number;
}

/**
 * What one game hour of patrol does. Only enemies (countries at war with the patrol's owner) are ever hurt.
 * Over friendly or neutral land there is no air defence, so the aircraft only take damage from dogfights.
 */
export function patrolHour(units: Units, s: PatrolSituation): PatrolHour {
  // The bombing is spread over the armies in the circle: beyond four of them each one is hit less.
  const spread = Math.min(1, 4 / Math.max(1, s.enemyArmies));
  const groundLossPct = s.enemyGroundUnits > 0 ? Math.min(0.12, (sum(units, GROUND_WEIGHT) / 12000) * spread) : 0;
  const bombs = sum(units, BUILDING_WEIGHT);
  const buildingPoints = s.enemyBuildings > 0 ? Math.min(15, bombs / (40 * s.enemyBuildings)) : 0;
  const flak = Math.min(0.08, 0.003 * s.enemyProvinces + 0.0003 * s.enemyGroundUnits * (s.enemyProvinces > 0 ? 1 : 0));
  const own = airPower(units);
  let dogfightOwn = 0;
  let enemyAirLossPct = 0;
  if (s.enemyAirPower > 0 && own > 0) {
    dogfightOwn = 0.12 * (s.enemyAirPower / (own + s.enemyAirPower));
    enemyAirLossPct = 0.12 * (own / (own + s.enemyAirPower));
  }
  return { groundLossPct, buildingPoints, ownLossPct: Math.min(0.25, flak + dogfightOwn), enemyAirLossPct };
}

/** Compounds an hourly rate over several hours. */
export const overHours = (pct: number, hours: number): number => 1 - Math.pow(1 - pct, hours);

/** Units lost from `count` at share `pct`: the whole part for sure, the fraction by a seeded roll. */
export function lossCount(count: number, pct: number, seed: number): number {
  const expected = count * pct;
  const base = Math.floor(expected);
  const roll = (seed % 10000) / 10000;
  return Math.min(count, base + (roll < expected - base ? 1 : 0));
}
