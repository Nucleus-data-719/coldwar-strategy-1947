import { PROVINCE_BY_KEY } from './map-data';
import { isAirFormation } from './patrol';
import { isNavalFormation } from './movement';
import type { UnitType } from './types';

type Units = { unitType: UnitType; count: number }[];

/** Land forces only join land forces, aircraft only aircraft, ships only ships. A mixed land and air force counts as land. */
export type ArmyDomain = 'land' | 'air' | 'naval';
export const armyDomain = (units: Units): ArmyDomain => (isNavalFormation(units) ? 'naval' : isAirFormation(units) ? 'air' : 'land');

export const ordinal = (n: number): string => {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 ? 0 : n % 10]}`;
};

/** Armies on the same spot closer than this (map units) count as being at the same place. */
export const SAME_SPOT = 16;

export function pointInPolygon(poly: number[], x: number, y: number): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], yi = poly[i * 2 + 1], xj = poly[j * 2], yj = poly[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Where an idle army stands: the point it was sent to, if that is still inside the province it is in, else null (the usual spot). */
export function restPoint(provinceKey: string, x: number | null | undefined, y: number | null | undefined): { x: number; y: number } | null {
  if (x == null || y == null) return null;
  const geo = PROVINCE_BY_KEY[provinceKey];
  return geo && pointInPolygon(geo.polygon, x, y) ? { x, y } : null;
}

/** Two idle armies in a province merge unless both were deliberately placed apart. */
export function sameSpot(a: { x: number; y: number } | null, b: { x: number; y: number } | null): boolean {
  if (!a || !b) return true;
  return Math.hypot(a.x - b.x, a.y - b.y) <= SAME_SPOT;
}

/** Your provinces that touch land of `targetId`, laid out along the border from one end to the other. */
export function borderProvinceKeys(myId: string, targetId: string, ownerByKey: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const [key, owner] of ownerByKey) {
    if (owner !== myId) continue;
    const geo = PROVINCE_BY_KEY[key];
    if (geo && geo.adjacent.some((k) => ownerByKey.get(k) === targetId)) out.push(key);
  }
  if (out.length < 3) return out;
  // order along the main direction of the stretch, so "spread out evenly" means evenly along the border
  let mx = 0, my = 0;
  for (const k of out) { mx += PROVINCE_BY_KEY[k].center.x; my += PROVINCE_BY_KEY[k].center.y; }
  mx /= out.length; my /= out.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const k of out) {
    const dx = PROVINCE_BY_KEY[k].center.x - mx, dy = PROVINCE_BY_KEY[k].center.y - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const proj = (k: string) => (PROVINCE_BY_KEY[k].center.x - mx) * cs + (PROVINCE_BY_KEY[k].center.y - my) * sn;
  return out.sort((a, b) => proj(a) - proj(b));
}

/**
 * Deals an army out along a border. Every border province gets at least one unit when there are enough; with a few
 * more units than provinces the extras go to evenly spread provinces; with fewer units than provinces, evenly spread
 * provinces are covered and the rest are left (cities and capitals first among equals).
 */
export function distributeToBorder(keys: string[], units: Units): { key: string; units: Units }[] {
  const total = units.reduce((s, u) => s + Math.max(0, u.count), 0);
  if (keys.length === 0 || total === 0) return [];
  const p = keys.length;
  const chosen: number[] = [];
  if (total >= p) for (let i = 0; i < p; i++) chosen.push(i);
  else {
    // evenly spaced picks; shift to a neighbouring city province when one is next door
    const used = new Set<number>();
    for (let i = 0; i < total; i++) {
      let idx = Math.min(p - 1, Math.floor(((i + 0.5) * p) / total));
      const near = [idx, idx - 1, idx + 1].filter((j) => j >= 0 && j < p && !used.has(j));
      const city = near.find((j) => PROVINCE_BY_KEY[keys[j]]?.isCity || PROVINCE_BY_KEY[keys[j]]?.isCapital);
      idx = city ?? near[0] ?? idx;
      used.add(idx);
      chosen.push(idx);
    }
    chosen.sort((a, b) => a - b);
  }
  // deal soldiers one at a time, cycling through the chosen provinces, so every province gets a mix of unit types
  const slots = chosen.length;
  const got: Map<string, number>[] = chosen.map(() => new Map());
  let cur = 0;
  for (const u of units) {
    for (let n = 0; n < u.count; n++) {
      const m = got[cur % slots];
      m.set(u.unitType, (m.get(u.unitType) ?? 0) + 1);
      cur++;
    }
  }
  return chosen.map((idx, i) => ({
    key: keys[idx],
    units: [...got[i].entries()].map(([unitType, count]) => ({ unitType: unitType as UnitType, count })),
  }));
}
