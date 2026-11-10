import { UNITS } from './game-data/units';
import { PROVINCE_BY_KEY } from './map-data';
import type { Terrain, UnitType } from './types';

/** Travel-time multiplier for entering a province of this terrain. */
export const TERRAIN_MOVE_MULT: Record<Terrain, number> = {
  plains: 1,
  forest: 1.4,
  hills: 1.5,
  mountains: 2,
  desert: 1.3,
};

/** A leg between two provinces that both have a completed railway takes this share of the time. */
export const RAILWAY_MOVE_MULT = 0.5;

/** Distance between neighbouring province centres on the placeholder map. */
export const MAP_UNITS_PER_PROVINCE = 100;

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
  railway: boolean,
  gameSpeed: number,
): number {
  const a = PROVINCE_BY_KEY[fromKey];
  const b = PROVINCE_BY_KEY[toKey];
  const distance = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
  let hours = ((distance / MAP_UNITS_PER_PROVINCE) * TERRAIN_MOVE_MULT[b.terrain]) / speed;
  if (railway) hours *= RAILWAY_MOVE_MULT;
  return Math.max(1, Math.round((hours * 3600) / gameSpeed));
}

export interface RouteContext {
  countryId: string;
  /** province key -> owner country id */
  ownerByKey: ReadonlyMap<string, string>;
  /** keys of provinces with a completed railway */
  railwayKeys: ReadonlySet<string>;
  speed: number;
  gameSpeed: number;
}

export interface Route {
  /** Province keys from the start to the goal, inclusive. */
  path: string[];
  /** Seconds for each leg; one fewer entry than `path`. */
  legSeconds: number[];
  totalSeconds: number;
}

const hasRail = (ctx: RouteContext, a: string, b: string) => ctx.railwayKeys.has(a) && ctx.railwayKeys.has(b);

/**
 * Fastest route over province adjacency (Dijkstra on travel time).
 * Armies may only enter provinces their own country owns. Combat will widen this.
 * The server and the browser use this same function, so the preview matches the order.
 */
export function planRoute(startKey: string, goalKey: string, ctx: RouteContext): Route | null {
  if (ctx.speed <= 0) return null;
  if (!PROVINCE_BY_KEY[startKey] || !PROVINCE_BY_KEY[goalKey]) return null;
  if (ctx.ownerByKey.get(goalKey) !== ctx.countryId) return null;
  if (startKey === goalKey) return { path: [startKey], legSeconds: [], totalSeconds: 0 };

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
    for (const next of PROVINCE_BY_KEY[current].adjacent) {
      if (done.has(next) || ctx.ownerByKey.get(next) !== ctx.countryId) continue;
      const secs = legSeconds(current, next, ctx.speed, hasRail(ctx, current, next), ctx.gameSpeed);
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
    legs.push(legSeconds(path[i], path[i + 1], ctx.speed, hasRail(ctx, path[i], path[i + 1]), ctx.gameSpeed));
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
  railwayKeys: ReadonlySet<string>;
}

export type AdvanceResult =
  | { status: 'arrived'; locationKey: string }
  | { status: 'blocked'; locationKey: string }
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
    if (i.ownerByKey.get(next) !== i.countryId) return { status: 'blocked', locationKey: location };
    location = next;
    if (path.length === 0) return { status: 'arrived', locationKey: location };
    next = path.shift()!;
    const rail = i.railwayKeys.has(location) && i.railwayKeys.has(next);
    const legArrives = arrivedAt + legSeconds(location, next, i.speed, rail, i.gameSpeed) * 1000;
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
