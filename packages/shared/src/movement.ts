import { UNITS } from './game-data/units';
import { PROVINCE_BY_KEY, hasPort, roadBetween, roadPath, seaRoute, type RoadKind } from './map-data';
import type { Terrain, UnitType } from './types';

/** Travel-time multiplier for entering a province of this terrain. */
export const TERRAIN_MOVE_MULT: Record<Terrain, number> = {
  plains: 1,
  forest: 1.4,
  hills: 1.5,
  mountains: 2,
  desert: 1.3,
};

/** A leg between two provinces that both have a completed railway takes this share of the time; with one railway, halfway between this and 1. */
export const RAILWAY_MOVE_MULT = 0.5;

/** Highways (out of capitals) are quicker than ordinary roads; ferries are slow sea lanes. */
export const ROAD_MOVE_MULT: Record<RoadKind, number> = { highway: 0.75, road: 1, ferry: 1.6 };

/** Distance between neighbouring province centres on the placeholder map. */
export const MAP_UNITS_PER_PROVINCE = 100;

/** An army that contains any ship can only sail along coastal provinces. */
export const isNavalFormation = (units: { unitType: UnitType; count: number }[]): boolean =>
  units.some((u) => u.count > 0 && UNITS[u.unitType].category === 'naval');

/** A force of only ships and aircraft cannot occupy land. */
export const canOccupyLand = (units: { unitType: UnitType; count: number }[]): boolean =>
  units.some((u) => u.count > 0 && UNITS[u.unitType].category === 'land');

/** A formation moves at the speed of its slowest unit. 0 means it has no units. */
export function formationSpeed(units: { unitType: UnitType; count: number }[]): number {
  let slowest = Infinity;
  for (const u of units) {
    if (u.count > 0) slowest = Math.min(slowest, UNITS[u.unitType].speed);
  }
  return Number.isFinite(slowest) ? slowest : 0;
}

/**
 * Real seconds to cross from one province to the next.
 * speed 1 = one province per game hour on plains. Divided by the game speed setting.
 */
export function legSeconds(
  fromKey: string,
  toKey: string,
  speed: number,
  /** 2 (or true) when both provinces have a railway, 1 when one does: each railway covers its own half of the leg. */
  railway: boolean | number,
  gameSpeed: number,
  roadMult = 1,
  sea = false,
): number {
  const a = PROVINCE_BY_KEY[fromKey];
  const b = PROVINCE_BY_KEY[toKey];
  let distance = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
  if (sea) {
    // ships follow the dots over the ocean
    distance = seaRoute(fromKey, toKey)?.length ?? distance;
    const hoursAtSea = distance / MAP_UNITS_PER_PROVINCE / speed;
    return Math.max(1, Math.round((hoursAtSea * 3600) / gameSpeed));
  }
  if (roadBetween(fromKey, toKey) === 'ferry') {
    const pts = roadPath(fromKey, toKey);
    distance = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (seg < 1000) distance += seg; // a lane that leaves one map edge and re-enters on the other does not count the jump
    }
  }
  let hours = ((distance / MAP_UNITS_PER_PROVINCE) * TERRAIN_MOVE_MULT[b.terrain]) / speed;
  const railEnds = railway === true ? 2 : railway === false ? 0 : railway;
  if (railEnds >= 2) hours *= RAILWAY_MOVE_MULT;
  else if (railEnds === 1) hours *= (1 + RAILWAY_MOVE_MULT) / 2;
  hours *= roadMult;
  return Math.max(1, Math.round((hours * 3600) / gameSpeed));
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
}

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
const hasRail = (ctx: RouteContext, a: string, b: string) => railEnds(ctx.railwayKeys, a, b);

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
      const secs = legSeconds(current, next, ctx.speed, hasRail(ctx, current, next), ctx.gameSpeed, roadMultFor(ctx.useRoads, current, next));
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
    legs.push(legSeconds(path[i], path[i + 1], ctx.speed, hasRail(ctx, path[i], path[i + 1]), ctx.gameSpeed, roadMultFor(ctx.useRoads, path[i], path[i + 1])));
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
    const rail = railEnds(i.railwayKeys, location, next);
    const legArrives = arrivedAt + legSeconds(location, next, i.speed, rail, i.gameSpeed, roadMultFor(i.useRoads, location, next), i.coastalOnly) * 1000;
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
