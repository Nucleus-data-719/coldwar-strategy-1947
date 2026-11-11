import { PROVINCE_BY_KEY, roadBetween, roadPath, seaRoute, type Point } from '@cw/shared';

const centre = (key: string): Point => [PROVINCE_BY_KEY[key].center.x, PROVINCE_BY_KEY[key].center.y];

/** The line one leg of a march follows: along the sea dots for ships, through the border crossing for roads, straight for aircraft. */
export function legPolyline(from: string, to: string, naval: boolean): Point[] {
  if (naval) return seaRoute(from, to)?.points ?? [centre(from), centre(to)];
  if (roadBetween(from, to)) return roadPath(from, to);
  return [centre(from), centre(to)];
}

/** Joins the legs of a whole route into one line. */
export function routePolyline(keys: string[], naval: boolean): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < keys.length; i++) {
    const leg = legPolyline(keys[i], keys[i + 1], naval);
    out.push(...(i === 0 ? leg : leg.slice(1)));
  }
  return out.length ? out : keys.length ? [centre(keys[0])] : [];
}

/** A segment longer than this is a jump across the map edge, not a stretch of road. */
export const JUMP = 1000;
const segLen = (a: Point, b: Point) => {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return d > JUMP ? 0 : d;
};
export const polylineLength = (pts: Point[]) => {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += segLen(pts[i - 1], pts[i]);
  return n;
};

/** The point a fraction t of the way along a line, and the rest of the line from there. */
export function splitAt(pts: Point[], t: number): { at: Point; rest: Point[] } {
  const total = polylineLength(pts);
  let want = total * Math.min(1, Math.max(0, t));
  for (let i = 1; i < pts.length; i++) {
    const seg = segLen(pts[i - 1], pts[i]);
    if (want <= seg || i === pts.length - 1) {
      const u = seg > 0 ? Math.min(1, want / seg) : 1;
      const at: Point = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
      return { at, rest: [at, ...pts.slice(i)] };
    }
    want -= seg;
  }
  return { at: pts[0], rest: pts };
}
