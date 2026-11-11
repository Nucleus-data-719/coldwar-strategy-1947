// Downloads CShapes 2.0 (country borders 1886-2019), keeps the borders valid on 31 Dec 1947, simplifies them
// and writes a small file you can attach to the chat.
//   node packages/shared/scripts/prepare-cshapes.mjs                (downloads from the ETH server)
//   node packages/shared/scripts/prepare-cshapes.mjs path/to/CShapes-2.0.geojson   (use a file you already have)
// Output: packages/shared/scripts/data/cshapes-1947.json
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ = 'https://icr.ethz.ch/data/cshapes/CShapes-2.0.geojson';
const AT = Date.UTC(1947, 11, 31); // the reference date
const TOLERANCE = 0.04; // degrees, about 4 km: plenty for a game map
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'data', 'cshapes-1947.json');

const src = process.argv[2];
let raw;
if (src) raw = readFileSync(src, 'utf8');
else {
  console.log('Downloading', URL_, '(large, may take a minute)...');
  const res = await fetch(URL_);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  raw = await res.text();
}
console.log(`Read ${(raw.length / 1e6).toFixed(1)} MB`);
const geo = JSON.parse(raw);
const feats = geo.features ?? [];
if (!feats.length) throw new Error('No features in the file');
const keys = Object.keys(feats[0].properties ?? {});
console.log('Property names:', keys.join(', '));

// Dates: the file may carry year/month/day columns or a single date text. Be tolerant.
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
function dateOf(p, which) {
  const pre = which === 'start' ? 'gws' : 'gwe';
  if (p[pre + 'year'] !== undefined) {
    const y = num(p[pre + 'year']);
    if (!Number.isFinite(y)) return which === 'start' ? -Infinity : Infinity;
    return Date.UTC(y, (num(p[pre + 'month']) || 1) - 1, num(p[pre + 'day']) || 1);
  }
  const v = p[which] ?? p[pre + 'date'] ?? p[which + '_date'];
  if (v === undefined || v === null || v === '') return which === 'start' ? -Infinity : Infinity;
  const parts = String(v).split(/[-/T ]/).map(Number);
  if (parts.length >= 3 && parts.every((n, i) => i > 2 || Number.isFinite(n))) return Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? (which === 'start' ? -Infinity : Infinity) : t;
}

const pick = (p, ...names) => {
  for (const n of names) if (p[n] !== undefined && p[n] !== null && p[n] !== '') return p[n];
  return null;
};

// Douglas-Peucker
function simplify(pts, tol) {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / len2));
      const d = Math.hypot(pts[i][0] - (ax + t * dx), pts[i][1] - (ay + t * dy));
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const ring = (r) => {
  const s = simplify(r, TOLERANCE).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
  return s.length >= 4 ? s : null;
};
const polys = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

const out = [];
for (const f of feats) {
  const p = f.properties ?? {};
  if (dateOf(p, 'start') > AT || dateOf(p, 'end') < AT) continue;
  const rings = [];
  for (const poly of polys(f.geometry)) {
    const outer = ring(poly[0]);
    if (outer) rings.push([outer, ...poly.slice(1).map(ring).filter(Boolean)]);
  }
  if (!rings.length) continue;
  out.push({
    name: pick(p, 'cntry_name', 'name', 'country_name'),
    gwcode: pick(p, 'gwcode'),
    cowcode: pick(p, 'cowcode'),
    capital: pick(p, 'capname'),
    capLon: pick(p, 'caplong', 'caplon'),
    capLat: pick(p, 'caplat'),
    polygons: rings,
  });
}
console.log(`Countries on 31 Dec 1947: ${out.length}`);
console.log(out.map((c) => c.name).sort().join(', '));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ date: '1947-12-31', source: 'CShapes 2.0 (Schvitz et al.)', countries: out }));
console.log(`Wrote ${OUT} (${(statSync(OUT).size / 1e6).toFixed(1)} MB). Attach this file to the chat.`);
