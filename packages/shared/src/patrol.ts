import { UNITS } from './game-data/units';
import { MAP_UNITS_PER_PROVINCE } from './movement';
import { PROVINCES, PROVINCE_BY_KEY } from './map-data';
import type { UnitType } from './types';

type Units = { unitType: UnitType; count: number }[];

/** How far from the patrol point (map units, a province is about 100 across) each aircraft covers. */
export const PATROL_RADIUS: Partial<Record<UnitType, number>> = { fighter: 100, air_support: 90, bomber: 80 };
/** Farthest an aircraft can be sent on one patrol order, in map units. */
export const PATROL_MAX_FLIGHT = 800;
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

/** A mixed force patrols the area its shortest-ranged aircraft can cover. 0 when it is not an air force. */
export function patrolRadius(units: Units): number {
  if (!isAirFormation(units)) return 0;
  let r = Infinity;
  for (const u of units) if (u.count > 0) r = Math.min(r, PATROL_RADIUS[u.unitType] ?? 100);
  return Number.isFinite(r) ? r : 0;
}

/** Keys of every province whose centre lies inside the patrol circle (the patrol province itself included). */
export function provincesInCircle(centerKey: string, radius: number): string[] {
  const c = PROVINCE_BY_KEY[centerKey];
  if (!c) return [];
  return PROVINCES.filter((p) => Math.hypot(p.center.x - c.center.x, p.center.y - c.center.y) <= radius).map((p) => p.key);
}

export function patrolFlightSeconds(fromKey: string, toKey: string, speed: number, gameSpeed: number): number {
  const a = PROVINCE_BY_KEY[fromKey];
  const b = PROVINCE_BY_KEY[toKey];
  const hours = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) / MAP_UNITS_PER_PROVINCE / speed;
  return Math.max(1, Math.round((hours * 3600) / gameSpeed));
}
export const patrolDistance = (fromKey: string, toKey: string): number => {
  const a = PROVINCE_BY_KEY[fromKey];
  const b = PROVINCE_BY_KEY[toKey];
  return Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
};

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
