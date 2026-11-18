import { UNITS } from './game-data/units';
import {
  FERRY_KMH,
  MOVE_TIME_COMPRESSION,
  RAIL_KMH,
  SEALIFT_EMBARK_HOURS,
  SEALIFT_KMH,
  TERRAIN_MOBILITY_MULT,
} from './game-data/era';
import { mapKm, polylineKm, provinceKm } from './geo';
import { PROVINCE_BY_KEY, hasPort, roadBetween, roadPath, seaRoute, type RoadKind } from './map-data';
import type { Terrain, UnitType } from './types';

type Units = readonly { unitType: UnitType; count: number }[];

/** Travel-time multiplier for foot infantry entering a province of this terrain (tanks and guns: TERRAIN_MOBILITY_MULT). */
export const TERRAIN_MOVE_MULT: Record<Terrain, number> = TERRAIN_MOBILITY_MULT.foot;

/** Kept for reference: rail is now a fixed troop-train speed (RAIL_KMH), see legSeconds. */
export const RAILWAY_MOVE_MULT = 0.5;

/** Highways (out of capitals) are quicker than ordinary roads. Ferries move at FERRY_KMH whatever the unit. */
export const ROAD_MOVE_MULT: Record<RoadKind, number> = { highway: 0.75, road: 1, ferry: 1 };

/** Old placeholder-map scale (a province was 100 map units). Distances are now in km (see geo.ts). */
export const MAP_UNITS_PER_PROVINCE = 100;

/** An army that contains any ship can only sail along coastal provinces. */
export const isNavalFormation = (units: Units): boolean =>
  units.some((u) => u.count > 0 && UNITS[u.unitType].category === 'naval');

/** A force of only ships and aircraft cannot occupy land. */
export const canOccupyLand = (units: Units): boolean =>
  units.some((u) => u.count > 0 && UNITS[u.unitType].category === 'land');

/** A formation moves at the speed of its slowest unit, in real km/h. 0 means it has no units. */
export function formationSpeed(units: Units): number {
  let slowest = Infinity;
  for (const u of units) {
    if (u.count > 0) slowest = Math.min(slowest, UNITS[u.unitType].speed);
  }
  return Number.isFinite(slowest) ? slowest : 0;
}

/** Real seconds for a number of game hours at the given game speed (never under 1 s). */
const toSeconds = (hours: number, gameSpeed: number) => Math.max(1, Math.round((hours * 3600) / gameSpeed));

/** Game hours to cover `km` at a real speed of `kmh` (1950s time compression applied). */
export const moveHours = (km: number, kmh: number): number => (kmh > 0 ? km / (kmh * MOVE_TIME_COMPRESSION) : Infinity);

/**
 * A land leg with no road between two ports is a sealift: troops embark at a harbour and sail.
 * Land armies only start one from a province with a working harbour of their own (see planRoute).
 */
export const isSealiftLeg = (fromKey: string, toKey: string): boolean =>
  fromKey !== toKey && !roadBetween(fromKey, toKey) && hasPort(fromKey) && hasPort(toKey) && !!seaRoute(fromKey, toKey);

/** Game hours for a sealift: loading and landing, plus the voyage at transport speed. */
export function sealiftHours(fromKey: string, toKey: string): number {
  const route = seaRoute(fromKey, toKey);
  const km = route ? polylineKm(route.points) : provinceKm(fromKey, toKey);
  return SEALIFT_EMBARK_HOURS + moveHours(km, SEALIFT_KMH);
}

export interface LegOptions {
  /** The units that march. Each one is timed with its own speed and terrain penalty; the slowest decides. */
  units?: Units;
  /** Aircraft: a straight flight, no roads or terrain. */
  air?: boolean;
}

/** Which ends of a leg have a working railway: [from, to]. A number gives how many (1 counts as the far end). */
type RailInput = boolean | number | readonly [boolean, boolean];
const railPair = (r: RailInput): [boolean, boolean] =>
  Array.isArray(r) ? [r[0], r[1]] : r === true || r === 2 ? [true, true] : r === 1 ? [false, true] : [false, false];

/** Game hours for one half of a leg, for one kind of unit. */
function halfHours(km: number, kmh: number, mobility: string, terrain: Terrain, rail: boolean, roadMult: number): number {
  if (rail) return moveHours(km, Math.max(kmh, RAIL_KMH));
  const mult = mobility === 'foot' || mobility === 'towed' || mobility === 'tracked' ? TERRAIN_MOBILITY_MULT[mobility][terrain] : 1;
  return moveHours(km, kmh) * mult * roadMult;
}

/**
 * Real seconds to cross from one province to the next (divided by the game speed setting).
 * Distances are real km. Each half of a leg lies in one province: its terrain slows the units
 * crossing it, and a working railway there carries every unit at troop-train speed instead.
 * `speed` is the slowest unit's km/h, used when `opts.units` is not given.
 */
export function legSeconds(
  fromKey: string,
  toKey: string,
  speed: number,
  railway: RailInput,
  gameSpeed: number,
  roadMult = 1,
  sea = false,
  opts: LegOptions = {},
): number {
  const a = PROVINCE_BY_KEY[fromKey];
  const b = PROVINCE_BY_KEY[toKey];
  if (sea) {
    // ships follow the dots over the ocean
    const route = seaRoute(fromKey, toKey);
    const km = route ? polylineKm(route.points) : provinceKm(fromKey, toKey);
    return toSeconds(moveHours(km, speed), gameSpeed);
  }
  if (opts.air) return toSeconds(moveHours(provinceKm(fromKey, toKey), speed), gameSpeed);
  const kind = roadBetween(fromKey, toKey);
  if (kind === 'ferry') return toSeconds(moveHours(polylineKm(roadPath(fromKey, toKey)), FERRY_KMH), gameSpeed);
  if (!kind && isSealiftLeg(fromKey, toKey)) return toSeconds(sealiftHours(fromKey, toKey), gameSpeed);

  const km = kind ? polylineKm(roadPath(fromKey, toKey)) : mapKm([a.center.x, a.center.y], [b.center.x, b.center.y]);
  const half = km / 2;
  const [railA, railB] = railPair(railway);
  const movers: { kmh: number; mobility: string }[] = [];
  for (const u of opts.units ?? []) {
    if (u.count > 0) movers.push({ kmh: UNITS[u.unitType].speed, mobility: UNITS[u.unitType].mobility });
  }
  if (movers.length === 0) movers.push({ kmh: speed, mobility: 'foot' });
  let hours = 0;
  for (const m of movers) {
    const h = halfHours(half, m.kmh, m.mobility, a.terrain, railA, roadMult) + halfHours(half, m.kmh, m.mobility, b.terrain, railB, roadMult);
    hours = Math.max(hours, h);
  }
  return toSeconds(hours, gameSpeed);
}

export type Relation = 'own' | 'hostile' | 'blocked';

/** Own provinces are free to enter, provinces of countries at war with us are fought over, the rest are closed. */
export function relationOf(
  ownerId: string | undefined,
  countryId: string,
  atWarWith: ReadonlySet<string>,
): Relation {
  if (ownerId === countryId) return 'own';
  if (ownerId !== undefined && atWarWith.has(ownerId)) return 'hostile';
  return 'blocked';
}

export interface RouteContext {
  countryId: string;
  /** province key -> owner country id */
  ownerByKey: ReadonlyMap<string, string>;
  /** ids of countries we are at war with */
  atWarWith: ReadonlySet<string>;
  /** keys of provinces with a completed railway */
  railwayKeys: ReadonlySet<string>;
  speed: number;
  gameSpeed: number;
  /** Ships: only coastal provinces may be entered. */
  coastalOnly?: boolean;
  /** Land forces: move only along roads (highways are faster). Ships and aircraft ignore roads. */
  useRoads?: boolean;
  /** The units that move: each is timed with its own speed and terrain penalty. */
  units?: Units;
  /** Aircraft: fly straight to the target over any land (see airOrderProblem for range and airbases). */
  air?: boolean;
  /** Provinces with a working harbour. A land army standing in one of yours may sail to any port (sealift). */
  harborKeys?: ReadonlySet<string>;
}

/** Aircraft fly straight to their target. */
const isAir = (ctx: { coastalOnly?: boolean; air?: boolean }) => !ctx.coastalOnly && !!ctx.air;

/** Time multiplier for a leg: the road kind for land forces, 1 for ships and aircraft. */
export const roadMultFor = (useRoads: boolean | undefined, a: string, b: string): number => {
  if (!useRoads) return 1;
  const kind = roadBetween(a, b);
  return kind ? ROAD_MOVE_MULT[kind] : 1;
};

export interface Route {
  /** Province keys from the start to the goal, inclusive. */
  path: string[];
  /** Seconds for each leg; one fewer entry than `path`. */
  legSeconds: number[];
  totalSeconds: number;
}

/** How many ends of a leg have a railway (0, 1 or 2). A railway lies inside its own province, so it speeds up only that half of the leg. */
export const railEnds = (rails: ReadonlySet<string>, a: string, b: string) => (rails.has(a) ? 1 : 0) + (rails.has(b) ? 1 : 0);
const railAt = (rails: ReadonlySet<string>, a: string, b: string): [boolean, boolean] => [rails.has(a), rails.has(b)];
const hasRail = (ctx: RouteContext, a: string, b: string) => railAt(ctx.railwayKeys, a, b);

const canEnter = (ctx: RouteContext, key: string) =>
  relationOf(ctx.ownerByKey.get(key), ctx.countryId, ctx.atWarWith) !== 'blocked' &&
  (!ctx.coastalOnly || hasPort(key));

/**
 * Fastest route over province adjacency (Dijkstra on travel time).
 * Armies may enter their own provinces and provinces of countries they are at war with
 * (a battle is fought on arrival). Other countries' land is closed.
 * The server and the browser use this same function, so the preview matches the order.
 */
export function planRoute(startKey: string, goalKey: string, ctx: RouteContext): Route | null {
  if (ctx.speed <= 0) return null;
  if (!PROVINCE_BY_KEY[startKey] || !PROVINCE_BY_KEY[goalKey]) return null;
  if (!canEnter(ctx, goalKey)) return null;
  if (startKey === goalKey) return { path: [startKey], legSeconds: [], totalSeconds: 0 };

  if (ctx.coastalOnly) {
    // Ships sail straight from port to port along the sea dots.
    if (!seaRoute(startKey, goalKey)) return null;
    const secs = legSeconds(startKey, goalKey, ctx.speed, false, ctx.gameSpeed, 1, true);
    return { path: [startKey, goalKey], legSeconds: [secs], totalSeconds: secs };
  }
  if (isAir(ctx)) {
    // Aircraft fly straight over any land; range and airbases are checked by airOrderProblem.
    const secs = legSeconds(startKey, goalKey, ctx.speed, false, ctx.gameSpeed, 1, false, { air: true });
    return { path: [startKey, goalKey], legSeconds: [secs], totalSeconds: secs };
  }
  const overland = roadRoute(startKey, goalKey, ctx);
  // Sealift: troops in one of your harbours may sail to any port and land there, an enemy one too (amphibious assault).
  if (ctx.useRoads && ctx.harborKeys?.has(startKey) && ctx.ownerByKey.get(startKey) === ctx.countryId && isSealiftLeg(startKey, goalKey)) {
    const secs = toSeconds(sealiftHours(startKey, goalKey), ctx.gameSpeed);
    if (!overland || secs < overland.totalSeconds) return { path: [startKey, goalKey], legSeconds: [secs], totalSeconds: secs };
  }
  return overland;
}

/** Fastest route along roads (or province adjacency): Dijkstra on travel time. */
function roadRoute(startKey: string, goalKey: string, ctx: RouteContext): Route | null {
  const leg = (a: string, b: string) =>
    legSeconds(a, b, ctx.speed, hasRail(ctx, a, b), ctx.gameSpeed, roadMultFor(ctx.useRoads, a, b), false, { units: ctx.units });

  const dist = new Map<string, number>([[startKey, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();

  for (;;) {
    let current: string | null = null;
    let best = Infinity;
    for (const [key, d] of dist) {
      if (!done.has(key) && d < best) {
        best = d;
        current = key;
      }
    }
    if (current === null) return null;
    if (current === goalKey) break;
    done.add(current);
    const neighbours = ctx.useRoads ? PROVINCE_BY_KEY[current].roads : PROVINCE_BY_KEY[current].adjacent;
    for (const next of neighbours) {
      if (done.has(next) || !canEnter(ctx, next)) continue;
      const secs = leg(current, next);
      const candidate = best + secs;
      if (candidate < (dist.get(next) ?? Infinity)) {
        dist.set(next, candidate);
        prev.set(next, current);
      }
    }
  }

  const path: string[] = [goalKey];
  while (path[0] !== startKey) path.unshift(prev.get(path[0])!);
  const legs: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    legs.push(leg(path[i], path[i + 1]));
  }
  return { path, legSeconds: legs, totalSeconds: legs.reduce((s, n) => s + n, 0) };
}

export interface AdvanceInput {
  /** Last province fully reached. */
  locationKey: string;
  /** Province of the leg that has just finished (its arrival time has passed). */
  nextKey: string;
  /** Provinces still to cross after `nextKey`. */
  remainingKeys: string[];
  /** When the finished leg ended, in ms. */
  legArrivesAt: number;
  now: number;
  speed: number;
  gameSpeed: number;
  countryId: string;
  ownerByKey: ReadonlyMap<string, string>;
  atWarWith: ReadonlySet<string>;
  railwayKeys: ReadonlySet<string>;
  /** Land forces: legs are timed by road kind. */
  useRoads?: boolean;
  /** Ships: legs follow the sea dots. */
  coastalOnly?: boolean;
  /** The units that move (see RouteContext.units). */
  units?: Units;
  /** Aircraft: legs are straight flights. */
  air?: boolean;
}

export type AdvanceResult =
  | { status: 'arrived'; locationKey: string }
  | { status: 'blocked'; locationKey: string }
  /**
   * The army reached a province held by an enemy. The caller fights the battle; if it is won
   * and the province changes hands, call advanceMovement again with the same remaining route.
   */
  | { status: 'battle'; locationKey: string; targetKey: string; remainingKeys: string[]; arrivedAt: number }
  | {
      status: 'moving';
      locationKey: string;
      nextKey: string;
      remainingKeys: string[];
      legStartedAt: number;
      legArrivesAt: number;
    };

/**
 * Applies every leg that finished while nobody was looking (a server restart, or a player
 * who was offline). Each leg starts at the exact moment the previous one ended, so time
 * never drifts however late the server notices.
 */
export function advanceMovement(i: AdvanceInput): AdvanceResult {
  if (i.speed <= 0) return { status: 'blocked', locationKey: i.locationKey };
  let location = i.locationKey;
  let next = i.nextKey;
  const path = [...i.remainingKeys];
  let arrivedAt = i.legArrivesAt;

  for (;;) {
    const relation = relationOf(i.ownerByKey.get(next), i.countryId, i.atWarWith);
    if (relation === 'blocked') return { status: 'blocked', locationKey: location };
    if (relation === 'hostile') {
      return { status: 'battle', locationKey: location, targetKey: next, remainingKeys: path, arrivedAt };
    }
    location = next;
    if (path.length === 0) return { status: 'arrived', locationKey: location };
    next = path.shift()!;
    const rail = railAt(i.railwayKeys, location, next);
    const legArrives =
      arrivedAt +
      legSeconds(location, next, i.speed, rail, i.gameSpeed, roadMultFor(i.useRoads, location, next), i.coastalOnly, { units: i.units, air: isAir(i) }) * 1000;
    if (legArrives > i.now) {
      return {
        status: 'moving',
        locationKey: location,
        nextKey: next,
        remainingKeys: path,
        legStartedAt: arrivedAt,
        legArrivesAt: legArrives,
      };
    }
    arrivedAt = legArrives;
  }
}
