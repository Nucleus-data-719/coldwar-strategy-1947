// Builds packages/shared/src/map-geometry.generated.ts from map-source.mjs.
//   node packages/shared/scripts/generate-map.mjs [--debug out.svg]
// Method: rasterise the land outlines on a 0.5 degree grid, give every land cell to the nearest
// province seed on the same landmass, then trace borders once per boundary so neighbouring
// provinces share exactly the same edge.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRIDGES, HULLS, SEEDS, WATERS } from './map-source.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const LON0 = -141, LON1 = 166, LAT0 = -56, LAT1 = 78;
const CELL = 0.5;
const SX = 9.6, SY = 12; // map units per degree
const W = Math.round((LON1 - LON0) / CELL);
const H = Math.round((LAT1 - LAT0) / CELL);
const MAP_W = Math.round((LON1 - LON0) * SX);
const MAP_H = Math.round((LAT1 - LAT0) * SY);

const lonOf = (i) => LON0 + i * CELL;
const latOf = (j) => LAT1 - j * CELL;
const mx = (lon) => (lon - LON0) * SX;
const my = (lat) => (LAT1 - lat) * SY;

// ---------- land mask ----------
function inPoly(x, y, poly) {
  let inside = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, ya] = poly[a];
    const [xb, yb] = poly[b];
    if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}
const box = (poly) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, x1, y0, y1 };
};
const hulls = Object.entries(HULLS).map(([name, poly]) => ({ name, poly, ...box(poly) }));
const waters = Object.entries(WATERS).map(([name, poly]) => ({ name, poly, ...box(poly) }));

const land = new Uint8Array(W * H);
for (let j = 0; j < H; j++) {
  const lat = latOf(j) - CELL / 2;
  for (let i = 0; i < W; i++) {
    const lon = lonOf(i) + CELL / 2;
    let isLand = false;
    for (const h of hulls) {
      if (lon < h.x0 || lon > h.x1 || lat < h.y0 || lat > h.y1) continue;
      if (inPoly(lon, lat, h.poly)) { isLand = true; break; }
    }
    if (isLand) {
      for (const w of waters) {
        if (lon < w.x0 || lon > w.x1 || lat < w.y0 || lat > w.y1) continue;
        if (inPoly(lon, lat, w.poly)) { isLand = false; break; }
      }
    }
    land[j * W + i] = isLand ? 1 : 0;
  }
}

// ---------- landmasses ----------
const comp = new Int32Array(W * H).fill(-1);
let compCount = 0;
for (let s = 0; s < W * H; s++) {
  if (!land[s] || comp[s] >= 0) continue;
  const stack = [s];
  comp[s] = compCount;
  while (stack.length) {
    const c = stack.pop();
    const ci = c % W, cj = (c - ci) / W;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni;
      if (land[n] && comp[n] < 0) { comp[n] = compCount; stack.push(n); }
    }
  }
  compCount++;
}

// ---------- seeds ----------
const seeds = SEEDS.map(([name, code, lon, lat, terrain, deposit, dbl], idx) => ({
  idx, name, code, lon, lat, terrain, deposit, doubled: dbl === 2,
  x: mx(lon), y: my(lat),
  comp: (() => {
    const i = Math.floor((lon - LON0) / CELL), j = Math.floor((LAT1 - lat) / CELL);
    // The seed may sit a hair offshore: use the nearest land cell for its landmass.
    for (let r = 0; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const ni = i + di, nj = j + dj;
      if (ni >= 0 && nj >= 0 && ni < W && nj < H && comp[nj * W + ni] >= 0) return comp[nj * W + ni];
    }
    return -1;
  })(),
}));
const bad = seeds.filter((s) => s.comp < 0);
if (bad.length) { console.error('seeds not on land:', bad.map((b) => b.name).join(', ')); process.exit(1); }
const names = new Set();
for (const s of seeds) { if (names.has(s.name)) { console.error('duplicate seed name', s.name); process.exit(1); } names.add(s.name); }

const seedsByComp = new Map();
for (const s of seeds) { if (!seedsByComp.has(s.comp)) seedsByComp.set(s.comp, []); seedsByComp.get(s.comp).push(s); }

const reg = new Int16Array(W * H).fill(-1);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const c = j * W + i;
  if (!land[c]) continue;
  const list = seedsByComp.get(comp[c]);
  if (!list) continue; // landmass with no seed (tiny island): becomes sea
  const x = mx(lonOf(i) + CELL / 2), y = my(latOf(j) - CELL / 2);
  let best = Infinity, who = -1;
  for (const s of list) {
    const d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d < best) { best = d; who = s.idx; }
  }
  reg[c] = who;
}

// ---------- keep each province in one piece ----------
function fixOrphans() {
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    const seen = new Uint8Array(W * H);
    const parts = new Map(); // region -> list of cell arrays
    for (let s = 0; s < W * H; s++) {
      if (reg[s] < 0 || seen[s]) continue;
      const r = reg[s];
      const cells = [];
      const stack = [s];
      seen[s] = 1;
      while (stack.length) {
        const c = stack.pop();
        cells.push(c);
        const ci = c % W, cj = (c - ci) / W;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const n = nj * W + ni;
          if (!seen[n] && reg[n] === r) { seen[n] = 1; stack.push(n); }
        }
      }
      if (!parts.has(r)) parts.set(r, []);
      parts.get(r).push(cells);
    }
    for (const [r, list] of parts) {
      if (list.length < 2) continue;
      list.sort((a, b) => b.length - a.length);
      for (const cells of list.slice(1)) {
        const votes = new Map();
        for (const c of cells) {
          const ci = c % W, cj = (c - ci) / W;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = ci + di, nj = cj + dj;
            if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
            const n = reg[nj * W + ni];
            if (n >= 0 && n !== r) votes.set(n, (votes.get(n) ?? 0) + 1);
          }
        }
        let to = -1, best = 0;
        for (const [n, v] of votes) if (v > best) { best = v; to = n; }
        for (const c of cells) reg[c] = to; // -1 when nothing touches it: becomes sea
        changed = true;
      }
    }
    if (!changed) break;
  }
}
fixOrphans();

const cellCount = new Map();
for (let c = 0; c < W * H; c++) if (reg[c] >= 0) cellCount.set(reg[c], (cellCount.get(reg[c]) ?? 0) + 1);
const missing = seeds.filter((s) => !cellCount.has(s.idx));
if (missing.length) { console.error('provinces with no land:', missing.map((m) => m.name).join(', ')); process.exit(1); }
const tiny = seeds.filter((s) => cellCount.get(s.idx) < 6);
if (tiny.length) console.warn('very small provinces:', tiny.map((t) => `${t.name}(${cellCount.get(t.idx)})`).join(', '));

// ---------- boundary edges ----------
const VW = W + 1;
const vid = (i, j) => j * VW + i;
const edges = []; // {a, b, left, right} a->b has `right` region on its right (clockwise around `right`)
const edgesAt = new Map();
function addEdge(a, b, r, n) {
  const id = edges.length;
  edges.push({ a, b, r, n });
  for (const v of [a, b]) { if (!edgesAt.has(v)) edgesAt.set(v, []); edgesAt.get(v).push(id); }
}
const regAt = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? -1 : reg[j * W + i]);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const r = reg[j * W + i];
  if (r < 0) continue;
  const sides = [
    [regAt(i, j - 1), vid(i, j), vid(i + 1, j)],         // top: left -> right
    [regAt(i + 1, j), vid(i + 1, j), vid(i + 1, j + 1)], // right: down
    [regAt(i, j + 1), vid(i + 1, j + 1), vid(i, j + 1)], // bottom: right -> left
    [regAt(i - 1, j), vid(i, j + 1), vid(i, j)],         // left: up
  ];
  for (const [n, a, b] of sides) {
    if (n === r) continue;
    if (n >= 0 && r > n) continue; // the other cell adds this edge
    addEdge(a, b, r, n);
  }
}

// ---------- chains between junctions ----------
const pairKey = (e) => (e.n < 0 ? `${e.r}|-1` : e.r < e.n ? `${e.r}|${e.n}` : `${e.n}|${e.r}`);
const isNode = new Set();
for (const [v, list] of edgesAt) {
  if (list.length !== 2) { isNode.add(v); continue; }
  if (pairKey(edges[list[0]]) !== pairKey(edges[list[1]])) isNode.add(v);
}
const used = new Uint8Array(edges.length);
const chains = []; // {pts: [vertex ids], right, left}

function walk(startVertex, firstEdge) {
  const pts = [startVertex];
  let v = startVertex;
  let e = firstEdge;
  const first = edges[e];
  const forward = first.a === v;
  const right = forward ? first.r : first.n;
  const left = forward ? first.n : first.r;
  for (;;) {
    used[e] = 1;
    const ed = edges[e];
    const next = ed.a === v ? ed.b : ed.a;
    pts.push(next);
    v = next;
    if (isNode.has(v) || v === startVertex) break;
    const cand = edgesAt.get(v).find((x) => x !== e && !used[x]);
    if (cand === undefined) break;
    e = cand;
  }
  chains.push({ pts, right, left });
}
for (const v of isNode) for (const e of edgesAt.get(v)) if (!used[e]) walk(v, e);
for (let e = 0; e < edges.length; e++) if (!used[e]) walk(edges[e].a, e); // closed loops (islands)

// ---------- simplify and smooth each chain once ----------
const TOL = 0.75; // in cells
const xy = (v) => [v % VW, Math.floor(v / VW)];
function dp(points, tol) {
  if (points.length <= 2) return points;
  const [ax, ay] = points[0], [bx, by] = points[points.length - 1];
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  let far = -1, farD = 0;
  for (let k = 1; k < points.length - 1; k++) {
    const [px, py] = points[k];
    const d = Math.abs(dy * (px - ax) - dx * (py - ay)) / len;
    if (d > farD) { farD = d; far = k; }
  }
  if (farD <= tol) return [points[0], points[points.length - 1]];
  const left = dp(points.slice(0, far + 1), tol);
  const right = dp(points.slice(far), tol);
  return [...left.slice(0, -1), ...right];
}
function chaikin(points) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let k = 0; k < points.length - 1; k++) {
    const [x0, y0] = points[k], [x1, y1] = points[k + 1];
    const last = k === points.length - 2, first = k === 0;
    out.push(first ? [x0 * 0.5 + x1 * 0.5, y0 * 0.5 + y1 * 0.5] : [x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25]);
    out.push(last ? [x1, y1] : [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
  }
  // first segment kept its start; last point is the true end
  return out;
}
for (const ch of chains) {
  let pts = ch.pts.map(xy);
  const closed = ch.pts[0] === ch.pts[ch.pts.length - 1];
  if (closed && pts.length > 6) {
    const mid = Math.floor(pts.length / 2);
    pts = [...dp(pts.slice(0, mid + 1), TOL).slice(0, -1), ...dp(pts.slice(mid), TOL)];
  } else {
    pts = dp(pts, TOL);
  }
  if (pts.length > 2) pts = chaikin(pts);
  ch.out = pts.map(([i, j]) => [lonOf(0) + i * CELL, LAT1 - j * CELL]).map(([lon, lat]) => [mx(lon), my(lat)]);
}

// ---------- assemble province rings ----------
const rings = new Map(); // region -> list of {start, end, pts}
for (const ch of chains) {
  const startV = ch.pts[0], endV = ch.pts[ch.pts.length - 1];
  if (ch.right >= 0) addSeg(ch.right, startV, endV, ch.out);
  if (ch.left >= 0) addSeg(ch.left, endV, startV, [...ch.out].reverse());
}
function addSeg(region, s, e, pts) {
  if (!rings.has(region)) rings.set(region, []);
  rings.get(region).push({ s, e, pts });
}
const area = (poly) => {
  let a = 0;
  for (let k = 0; k < poly.length; k++) {
    const [x0, y0] = poly[k], [x1, y1] = poly[(k + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
};
const polygons = new Map();
for (const [region, segs] of rings) {
  const left = new Set(segs.map((_, k) => k));
  const loops = [];
  while (left.size) {
    const first = left.values().next().value;
    left.delete(first);
    let ring = [...segs[first].pts];
    let cur = segs[first];
    let guard = 0;
    while (cur.e !== segs[first].s && guard++ < 5000) {
      const nextK = [...left].find((k) => segs[k].s === cur.e);
      if (nextK === undefined) break;
      left.delete(nextK);
      cur = segs[nextK];
      ring = ring.concat(cur.pts.slice(1));
    }
    loops.push(ring);
  }
  loops.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  polygons.set(region, loops[0]);
}

// ---------- centres (deepest cell), adjacency, coast ----------
const centers = new Map();
const byRegion = new Map();
for (let c = 0; c < W * H; c++) if (reg[c] >= 0) { if (!byRegion.has(reg[c])) byRegion.set(reg[c], []); byRegion.get(reg[c]).push(c); }
for (const [r, cells] of byRegion) {
  const dist = new Map();
  const queue = [];
  for (const c of cells) {
    const ci = c % W, cj = (c - ci) / W;
    let edge = false;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (regAt(ci + di, cj + dj) !== r) edge = true;
    if (edge) { dist.set(c, 0); queue.push(c); }
  }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    const ci = c % W, cj = (c - ci) / W;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = ci + di, nj = cj + dj;
      if (regAt(ni, nj) !== r) continue;
      const n = nj * W + ni;
      if (!dist.has(n)) { dist.set(n, dist.get(c) + 1); queue.push(n); }
    }
  }
  let sx = 0, sy = 0;
  for (const c of cells) { sx += c % W; sy += Math.floor(c / W); }
  sx /= cells.length; sy /= cells.length;
  let best = -1, bestD = 0, bestScore = Infinity;
  for (const c of cells) {
    const d = dist.get(c) ?? 0;
    const ci = c % W, cj = Math.floor(c / W);
    const off = Math.hypot(ci - sx, cj - sy);
    // prefer deep cells; among near-equal depth prefer the one closest to the middle
    const score = -d * 3 + off;
    if (score < bestScore) { bestScore = score; best = c; bestD = d; }
  }
  const ci = best % W, cj = Math.floor(best / W);
  centers.set(r, [mx(lonOf(ci) + CELL / 2), my(latOf(cj) - CELL / 2)]);
}

const adj = new Map();
const coastal = new Set();
const link = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
for (const e of edges) {
  if (e.n < 0) coastal.add(e.r);
  else { link(e.r, e.n); link(e.n, e.r); }
}
const idxByName = new Map(seeds.map((s) => [s.name, s.idx]));
for (const [a, b] of BRIDGES) {
  const ia = idxByName.get(a), ib = idxByName.get(b);
  if (ia === undefined || ib === undefined) { console.error('bridge names not found', a, b); process.exit(1); }
  link(ia, ib); link(ib, ia);
}

// ---------- keys and output ----------
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const keyOf = (s) => slug(s.name);
const keys = new Set();
for (const s of seeds) { const k = keyOf(s); if (keys.has(k)) { console.error('duplicate key', k); process.exit(1); } keys.add(k); }

const round = (n) => Math.round(n * 10) / 10;
const rows = seeds.map((s) => ({
  key: keyOf(s),
  name: s.name,
  countryCode: s.code,
  terrain: { P: 'plains', F: 'forest', H: 'hills', M: 'mountains', D: 'desert' }[s.terrain],
  deposit: s.deposit,
  doubled: s.doubled || undefined,
  isCapital: seeds.find((x) => x.code === s.code).idx === s.idx,
  isCoastal: coastal.has(s.idx),
  center: centers.get(s.idx).map(round),
  polygon: polygons.get(s.idx).flatMap(([x, y]) => [round(x), round(y)]),
  adjacent: [...(adj.get(s.idx) ?? [])].map((i) => keyOf(seeds[i])).sort(),
}));

// sanity checks
let problems = 0;
for (const r of rows) {
  if (r.adjacent.length === 0) { console.warn('isolated province:', r.name); problems++; }
  const a = Math.abs(area(polygons.get(seeds.find((s) => keyOf(s) === r.key).idx)));
  const cells = cellCount.get(seeds.find((s) => keyOf(s) === r.key).idx);
  const expect = cells * CELL * SX * CELL * SY;
  if (a < expect * 0.8) console.warn(`polygon smaller than its cells: ${r.name} ${(a / expect).toFixed(2)}`);
}

const out = `// GENERATED by packages/shared/scripts/generate-map.mjs. Do not edit by hand.
export const MAP_WIDTH = ${MAP_W};
export const MAP_HEIGHT = ${MAP_H};

export interface GeneratedProvince {
  key: string;
  name: string;
  countryCode: string;
  terrain: 'plains' | 'forest' | 'hills' | 'mountains' | 'desert';
  /** The strategic resource this province produces (only provinces with a deposit produce one). */
  deposit?: 'oil' | 'steel' | 'electronics' | 'rare';
  /** A double-resource region: the deposit produces twice as much. */
  doubled?: boolean;
  isCapital: boolean;
  isCoastal: boolean;
  center: [number, number];
  polygon: number[];
  adjacent: string[];
}

export const GENERATED_PROVINCES: GeneratedProvince[] = ${JSON.stringify(rows)};
`;
writeFileSync(join(here, '..', 'src', 'map-geometry.generated.ts'), out);
console.log(`provinces: ${rows.length}, size ${(out.length / 1024).toFixed(0)} KB, problems ${problems}`);

// ---------- debug picture ----------
const dbg = process.argv.indexOf('--debug');
if (dbg > 0) {
  const palette = (code) => {
    let h = 0;
    for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  };
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_W} ${MAP_H}" width="${MAP_W}" height="${MAP_H}"><rect width="100%" height="100%" fill="#16324a"/>`];
  rows.forEach((r, k) => {
    const pts = [];
    for (let q = 0; q < r.polygon.length; q += 2) pts.push(`${r.polygon[q]},${r.polygon[q + 1]}`);
    const light = 42 + (k % 3) * 8;
    parts.push(`<polygon points="${pts.join(' ')}" fill="hsl(${palette(r.countryCode)},45%,${light}%)" stroke="#0b1d2e" stroke-width="1.2"/>`);
  });
  rows.forEach((r) => {
    parts.push(`<text x="${r.center[0]}" y="${r.center[1]}" font-size="11" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="0.4">${r.name}${r.isCapital ? ' ★' : ''}</text>`);
  });
  parts.push('</svg>');
  writeFileSync(process.argv[dbg + 1], parts.join('\n'));
}
