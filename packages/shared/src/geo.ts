import { PROVINCE_BY_KEY, type Point } from './map-data';

// The map generator projects longitude/latitude linearly (see scripts/generate-map.mjs).
const LON0 = -170;
const LAT1 = 78;
const SX = 9.6; // map units per degree of longitude
const SY = 12; // map units per degree of latitude
const EARTH_KM = 6371;
const RAD = Math.PI / 180;

/** Roughly how many km one map unit is north-south (about 9.2). Used to turn km into map units for drawing circles. */
export const KM_PER_MAP_UNIT = (111.2 * 1) / SY;

/** A map point back to longitude and latitude in degrees. */
export const toLonLat = (x: number, y: number): [number, number] => [LON0 + x / SX, LAT1 - y / SY];

/** Great-circle distance between two map points, in km. */
export function mapKm(a: Point, b: Point): number {
  const [lon1, lat1] = toLonLat(a[0], a[1]);
  const [lon2, lat2] = toLonLat(b[0], b[1]);
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A segment longer than this (map units) is a jump across the map edge and counts as nothing. */
const EDGE_JUMP = 1000;

/** Length of a line of map points in km, skipping jumps across the map edge. */
export function polylineKm(pts: readonly Point[]): number {
  let km = 0;
  for (let i = 1; i < pts.length; i++) {
    if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) > EDGE_JUMP) continue;
    km += mapKm(pts[i - 1], pts[i]);
  }
  return km;
}

/** Straight-line (great-circle) distance between two province centres, in km. Aircraft fly this. */
export function provinceKm(fromKey: string, toKey: string): number {
  const a = PROVINCE_BY_KEY[fromKey];
  const b = PROVINCE_BY_KEY[toKey];
  if (!a || !b) return Infinity;
  return mapKm([a.center.x, a.center.y], [b.center.x, b.center.y]);
}

/** Game hours needed to cover `km` at a real speed of `kmh`, with 1950s time compression applied by the caller. */
export const kmHours = (km: number, kmh: number, compression: number): number => (kmh > 0 ? km / (kmh * compression) : Infinity);
