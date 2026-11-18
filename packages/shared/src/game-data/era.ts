import type { Terrain } from '../types';

/**
 * 1950s movement rules. Unit speeds (see units.ts) are real sustained speeds in km/h for the early
 * 1950s. Movement runs this many times faster than real life, so one real hour of play is one day of
 * 1950s campaigning (at GAME_SPEED 1). Change this one number to make every march, voyage and flight
 * faster or slower together.
 */
export const MOVE_TIME_COMPRESSION = 24;

/** How a land unit moves: on foot or by truck, towed guns, or tracks. */
export type Mobility = 'foot' | 'towed' | 'tracked' | 'air' | 'sea';

/** Travel-time multiplier on each terrain, per kind of mobility. Tanks bog down in forests and mountains; deserts suit them. */
export const TERRAIN_MOBILITY_MULT: Record<'foot' | 'towed' | 'tracked', Record<Terrain, number>> = {
  foot: { plains: 1, forest: 1.25, hills: 1.3, mountains: 1.6, desert: 1.25 },
  towed: { plains: 1, forest: 1.5, hills: 1.5, mountains: 2.2, desert: 1.35 },
  tracked: { plains: 1, forest: 1.7, hills: 1.4, mountains: 2.4, desert: 1.15 },
};

/**
 * Troop trains (km/h, sustained, loading included). Every unit, tanks too, rides the train at this
 * speed and ignores terrain on the part of a leg that lies inside a province with a working railway.
 */
export const RAIL_KMH = 30;
/** Ferries and landing craft across the short sea lanes (about 8 knots). */
export const FERRY_KMH = 15;
/** Troop transports on a sealift between two ports (about 12 knots). */
export const SEALIFT_KMH = 22;
/** Game hours to load troops at the harbour and put them ashore on a sealift. */
export const SEALIFT_EMBARK_HOURS = 2;
/** Attack penalty for troops that land from the sea straight into an enemy province (Inchon was the exception). */
export const AMPHIBIOUS_ASSAULT_PERCENT = -25;

/** Aircraft may fly this many times their combat radius when they rebase to another airbase (one way, no fighting). */
export const AIR_FERRY_FACTOR = 2.5;

/**
 * Technology a country already had on 1 January 1950, by its size. Superpowers had jets, heavy bombers,
 * tanks and submarines; major powers had WWII-era tanks, fighters and escorts; medium powers had
 * surplus light tanks and piston fighters. Treated as researched from the start of every campaign.
 */
export const STARTING_TECHS_BY_TIER: Record<'super' | 'major' | 'medium' | 'minor', string[]> = {
  super: ['armor_1', 'air_1', 'naval_1', 'naval_2', 'air_2', 'ind_1'],
  major: ['armor_1', 'air_1', 'naval_1'],
  medium: ['armor_1', 'air_1'],
  minor: [],
};
