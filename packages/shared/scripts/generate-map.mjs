// Builds packages/shared/src/map-geometry.generated.ts.
//   node packages/shared/scripts/generate-map.mjs [--debug out.svg]
// Borders: CShapes 2.0 on 31 Dec 1947 (data/cshapes-1947.json). Cities, resources and playable countries: map-source.mjs.
// Method: rasterise the country borders on a 0.25 degree grid, put one seed on every city and deposit, spread the other
// provinces with k-means so each country gets its target number of provinces, give every land cell to the nearest seed
// on the same landmass, then trace the borders once per boundary so neighbouring provinces share exactly the same edge.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_CAPITAL_RESOURCE, AI_CITIES, CAPITAL_FIX, MERGE, PLAYABLE, RENAME } from './map-source.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const T0 = Date.now();
const lap = (s) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}`);

const LON0 = -170, LON1 = 180, LAT0 = -56, LAT1 = 78;
const CELL = 0.25;
const SX = 9.6, SY = 12; // map units per degree
const W = Math.round((LON1 - LON0) / CELL);
const H = Math.round((LAT1 - LAT0) / CELL);
const MAP_W = Math.round((LON1 - LON0) * SX);
const MAP_H = Math.round((LAT1 - LAT0) * SY);
const lonOf = (i) => LON0 + i * CELL;
const latOf = (j) => LAT1 - j * CELL;
const mx = (lon) => (lon - LON0) * SX;
const my = (lat) => (LAT1 - lat) * SY;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// ---------- countries ----------
const cs = JSON.parse(readFileSync(join(here, 'data', 'cshapes-1947.json'), 'utf8'));
const RES = { f: 'food', o: 'oil', s: 'steel', e: 'electronics', r: 'rare', w: 'wood' };
const playableByCode = new Map(PLAYABLE.map((p) => [p.code, p]));
const usedCodes = new Set(PLAYABLE.map((p) => p.code));
const autoCode = (name) => {
  const letters = name.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase();
  const tries = [letters.slice(0, 3), letters[0] + letters.slice(1).replace(/[AEIOU]/g, '').slice(0, 2), letters.slice(0, 2) + letters.slice(-1), letters[0] + letters.slice(-2)];
  for (const t of tries) if (t.length === 3 && !usedCodes.has(t)) { usedCodes.add(t); return t; }
  for (let k = 0; k < 1000; k++) { const t = letters.slice(0, 2) + String.fromCharCode(65 + (k % 26)) + (k >= 26 ? Math.floor(k / 26) : ''); if (!usedCodes.has(t)) { usedCodes.add(t); return t; } }
  throw new Error('no code for ' + name);
};
const countries = []; // {code, name, cs: [cshapes entries], playable, ...}
const byCode = new Map();
const csToCode = new Map();
for (const c of cs.countries) {
  let code = MERGE[c.name];
  if (!code) {
    const ex = countries.find((x) => x.baseName === c.name);
    code = ex ? ex.code : autoCode(RENAME[c.name] ?? c.name.replace(/\s*\(.*\)/, ''));
  }
  csToCode.set(c.name, code);
  if (!byCode.has(code)) {
    const p = playableByCode.get(code);
    const entry = { code, baseName: c.name, name: p ? p.name : RENAME[c.name] ?? c.name.replace(/\s*\(.*\)/, '').trim(), playable: !!p, spec: p, cs: [] };
    byCode.set(code, entry); countries.push(entry);
  }
  byCode.get(code).cs.push(c);
}
for (const p of PLAYABLE) if (!byCode.has(p.code)) { console.error('playable country has no CShapes entry:', p.code); process.exit(1); }
const cidx = new Map(countries.map((c, i) => [c.code, i + 1])); // raster value
lap(`${cs.countries.length} CShapes entries -> ${countries.length} countries (${PLAYABLE.length} playable)`);

// ---------- raster ----------
const cty = new Int16Array(W * H); // 0 = sea, else country index + 0
function fillRings(rings, val) {
  let minY = Infinity, maxY = -Infinity;
  for (const r of rings) for (const p of r) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  const j0 = Math.max(0, Math.floor((LAT1 - maxY) / CELL)), j1 = Math.min(H - 1, Math.ceil((LAT1 - minY) / CELL));
  for (let j = j0; j <= j1; j++) {
    const y = LAT1 - (j + 0.5) * CELL;
    const xs = [];
    for (const r of rings) for (let k = 0, n = r.length; k < n; k++) {
      const a = r[k], b = r[(k + 1) % n];
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - LON0) / CELL - 0.5)), i1 = Math.min(W - 1, Math.floor((xs[k + 1] - LON0) / CELL - 0.5));
      for (let i = i0; i <= i1; i++) cty[j * W + i] = val;
    }
  }
}
const ringArea = (r) => { let a = 0; for (let k = 0; k < r.length; k++) { const p = r[k], q = r[(k + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const jobs = [];
for (const c of cs.countries) {
  const code = csToCode.get(c.name);
  for (const poly of c.polygons) {
    const mnLon = Math.min(...poly[0].map((p) => p[0])), mnLat = Math.min(...poly[0].map((p) => p[1]));
    if (code === 'DNK' || c.name === 'Denmark') { if (mnLon < -20) continue; } // Greenland
    if (c.name === 'Norway' && mnLat > 74) continue; // Svalbard
    jobs.push({ val: cidx.get(code), poly, area: Math.abs(ringArea(poly[0])) });
  }
}
jobs.sort((a, b) => b.area - a.area); // small ones painted last so they win overlaps
for (const j of jobs) fillRings(j.poly, j.val);
lap(`raster ${W}x${H}, ${jobs.length} polygons`);

// Open sea = water with open water around it, found by its "core" cells. Everything else that is still water (slivers between
// slightly mismatched borders, small lakes, closed bays) becomes land of the neighbouring country.
const ocean = new Uint8Array(W * H);
{
  const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const waterAt = (i, j) => i < 0 || j < 0 || i >= W || j >= H || cty[j * W + i] === 0;
  const core = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (cty[j * W + i]) continue;
    let n = 0; for (const [di, dj] of N8) if (waterAt(i + di, j + dj)) n++;
    if (n >= 7) core[j * W + i] = 1;
  }
  const seen = new Uint8Array(W * H);
  const frontier = [];
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!core[s0] || seen[s0]) continue;
    const cells = [], st = [s0]; seen[s0] = 1;
    while (st.length) { const c = st.pop(); cells.push(c); const ci = c % W, cj = (c - ci) / W; for (const [di, dj] of N4) { const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue; const q = nj * W + ni; if (core[q] && !seen[q]) { seen[q] = 1; st.push(q); } } }
    if (cells.length >= 200) for (const c of cells) { ocean[c] = 1; frontier.push(c); }
  }
  // widen the open sea by three cells over water, so that coasts and narrow straits stay sea
  let layer = frontier;
  for (let step = 0; step < 3; step++) {
    const next = [];
    for (const c of layer) { const ci = c % W, cj = (c - ci) / W; for (const [di, dj] of N4) { const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue; const q = nj * W + ni; if (!cty[q] && !ocean[q]) { ocean[q] = 1; next.push(q); } } }
    layer = next;
  }
  let left = 0;
  for (let c = 0; c < W * H; c++) if (!cty[c] && !ocean[c]) left++;
  for (let pass = 0; pass < 80 && left > 0; pass++) {
    const add = [];
    for (let c = 0; c < W * H; c++) {
      if (cty[c] || ocean[c]) continue;
      const ci = c % W, cj = (c - ci) / W; const votes = new Map();
      for (const [di, dj] of N4) { const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue; const n = cty[nj * W + ni]; if (n) votes.set(n, (votes.get(n) ?? 0) + 1); }
      let b = 0, bv = 0; for (const [k, v] of votes) if (v > bv) { b = k; bv = v; }
      if (b) add.push([c, b]);
    }
    if (!add.length) break;
    for (const [c, b] of add) { cty[c] = b; left--; }
  }
  lap(`sea cleaned, ${left} water cells left over`);
}

// ---------- country landmasses ----------
const cellsOf = countries.map(() => []);
for (let c = 0; c < W * H; c++) if (cty[c]) cellsOf[cty[c] - 1].push(c);
const comp = new Int32Array(W * H).fill(-1);
const compsOf = countries.map(() => []); // {id, cells}
let compCount = 0;
for (let k = 0; k < countries.length; k++) {
  for (const s of cellsOf[k]) {
    if (comp[s] >= 0) continue;
    const cells = []; const st = [s]; comp[s] = compCount;
    while (st.length) {
      const c = st.pop(); cells.push(c);
      const ci = c % W, cj = (c - ci) / W;
      for (const [di, dj] of N4) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const n = nj * W + ni;
        if (cty[n] === k + 1 && comp[n] < 0) { comp[n] = compCount; st.push(n); }
      }
    }
    compsOf[k].push({ id: compCount, cells, fixed: [] });
    compCount++;
  }
}
lap(`${compCount} country landmasses`);

// ---------- fixed seeds: capitals, cities, deposits ----------
const fixedOf = countries.map(() => []); // {name, lon, lat, res, doubled, city, capital}
const warn = [];
for (let k = 0; k < countries.length; k++) {
  const ct = countries[k];
  if (ct.spec) {
    const sp = ct.spec;
    fixedOf[k].push({ name: sp.capital[0], lon: sp.capital[1], lat: sp.capital[2], res: sp.capital[3], city: true, capital: true });
    for (const c of sp.cities) fixedOf[k].push({ name: c[0], lon: c[1], lat: c[2], res: c[3], city: true });
    for (const d of sp.deposits) fixedOf[k].push({ name: d[0], lon: d[1], lat: d[2], res: d[3], doubled: true, city: false });
  } else {
    const first = ct.cs[0];
    const fix = CAPITAL_FIX[ct.baseName];
    const capName = fix ? fix[0] : (first.capital || ct.name).replace(/\s*\(.*\)/, '').trim();
    const lon = fix ? fix[1] : first.capLon, lat = fix ? fix[2] : first.capLat;
    fixedOf[k].push({ name: capName, lon, lat, res: AI_CAPITAL_RESOURCE[ct.baseName] ?? AI_CAPITAL_RESOURCE[ct.name] ?? 'f', city: true, capital: true });
  }
}
for (const [cname, name, lon, lat, res] of AI_CITIES) {
  const code = csToCode.get(cname);
  if (!code) { warn.push(`AI city for unknown country ${cname}`); continue; }
  fixedOf[cidx.get(code) - 1].push({ name, lon, lat, res, city: true });
}
// snap each fixed seed to the nearest cell of its country
for (let k = 0; k < countries.length; k++) {
  const keep = [];
  for (const f of fixedOf[k]) {
    const i0 = Math.floor((f.lon - LON0) / CELL), j0 = Math.floor((LAT1 - f.lat) / CELL);
    let best = null, bd = Infinity;
    for (let r = 0; r <= 12 && !best; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= W || j >= H || cty[j * W + i] !== k + 1) continue;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; best = [i, j]; }
      }
    }
    // a city within three quarters of a degree of the sea moves to the shore, so port cities are coastal provinces
    if (best && f.city) {
      const coastalCell = (i, j) => cty[j * W + i] === k + 1 && N4.some(([di, dj]) => { const a = i + di, b = j + dj; return a < 0 || b < 0 || a >= W || b >= H || ocean[b * W + a] === 1; });
      if (!coastalCell(best[0], best[1])) {
        let cb = null, cd = Infinity;
        for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const i = best[0] + di, j = best[1] + dj; if (i < 0 || j < 0 || i >= W || j >= H || !coastalCell(i, j)) continue; const d = di * di + dj * dj; if (d < cd) { cd = d; cb = [i, j]; } }
        if (cb) best = cb;
      }
    }
    if (!best) { warn.push(`${countries[k].name}: cannot place ${f.name} (${f.lon}, ${f.lat})`); if (f.capital) { /* fall back later */ } continue; }
    f.i = best[0]; f.j = best[1]; f.cell = best[1] * W + best[0];
    f.x = mx(lonOf(best[0]) + CELL / 2); f.y = my(latOf(best[1]) - CELL / 2);
    keep.push(f);
  }
  // two fixed seeds on one cell: the later one moves to the nearest free cell of the country
  const taken = new Set(); const placed = [];
  for (const f of keep) {
    if (taken.has(f.cell)) {
      let alt = null, ad = Infinity;
      for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) { const i = f.i + di, j = f.j + dj; if (i < 0 || j < 0 || i >= W || j >= H || cty[j * W + i] !== k + 1 || taken.has(j * W + i)) continue; const d = di * di + dj * dj; if (d < ad) { ad = d; alt = [i, j]; } }
      if (!alt) { warn.push(`${countries[k].name}: ${f.name} shares a cell, dropped`); continue; }
      f.i = alt[0]; f.j = alt[1]; f.cell = alt[1] * W + alt[0]; f.x = mx(lonOf(alt[0]) + CELL / 2); f.y = my(latOf(alt[1]) - CELL / 2);
    }
    taken.add(f.cell); placed.push(f);
  }
  fixedOf[k] = placed;
  for (const f of fixedOf[k]) { const cp = compsOf[k].find((c) => c.id === comp[f.cell]); cp.fixed.push(f); }
}

// ---------- how many provinces each country gets ----------
const cellArea = CELL * CELL; // square degrees
// Province density: provinces are packed where people lived, and spread thin over tundra, desert and highlands.
const DENS = {
  SOV: [[65, 190, 40, 80, 0.3], [40, 65, 55, 80, 0.55]], CAN: [[-170, -50, 55, 80, 0.35], [-170, -105, 40, 56, 0.6]], CHN: [[70, 100, 25, 45, 0.35]], AUS: [[116, 142, -32, -17, 0.45]],
  USA: [[-125, -104, 30, 50, 0.7]], BRA: [[-75, -52, -12, 5, 0.6]], SAU: [[38, 56, 15, 27, 0.6]], IRN: [[52, 63, 26, 36, 0.6]], ARG: [[-75, -60, -56, -40, 0.4]], MEX: [[-117, -105, 26, 33, 0.6]],
  IND: [[88, 100, 20, 30, 0.7]], ETH: [[41, 48, 4, 10, 0.5]], PAK: [[60, 70, 26, 31, 0.5]],
};
const weightOfCell = (c, code) => {
  const lon = lonOf(c % W) + CELL / 2, lat = latOf(Math.floor(c / W)) - CELL / 2;
  let w = lat > 62 || lat < -52 ? 0.4 : 1;
  for (const [a, b, c0, d, f] of DENS[code] ?? []) if (lon >= a && lon <= b && lat >= c0 && lat <= d) { w *= f; break; }
  return w;
};
const targetN = (k) => {
  const ct = countries[k];
  if (ct.spec) return ct.spec.n;
  const a = cellsOf[k].length * cellArea;
  if (a >= 150) return 15; if (a >= 110) return 13; if (a >= 80) return 11; if (a >= 55) return 9; if (a >= 30) return 7;
  if (a >= 18) return 6; if (a >= 10) return 5; if (a >= 5) return 4; if (a >= 2.5) return 3; if (a >= 1) return 2; return 1;
};
const MIN_CELLS = 6;
const ARCTIC = 72;
const provs = []; // seeds
const clouds = []; // per comp: seed list
const rng0 = mulberry32(1947);
for (let k = 0; k < countries.length; k++) {
  const ct = countries[k];
  let comps = compsOf[k];
  if (!comps.length) { ct.live = []; warn.push(`${ct.name}: too small for the grid, left out`); continue; }
  // arctic archipelagos and specks that hold no city are dropped
  for (const cp of comps) {
    let sl = 0; for (const c of cp.cells) sl += latOf(Math.floor(c / W));
    cp.meanLat = sl / cp.cells.length;
    cp.w = cp.cells.reduce((a, c) => a + weightOfCell(c, ct.code), 0);
    cp.drop = !cp.fixed.length && (cp.cells.length < MIN_CELLS || (cp.meanLat > ARCTIC && comps.length > 1));
  }
  let live = comps.filter((c) => !c.drop);
  if (!live.length) { live = [comps.slice().sort((a, b) => b.cells.length - a.cells.length)[0]]; live[0].drop = false; }
  for (const cp of comps) if (cp.drop) for (const c of cp.cells) { cty[c] = 0; }
  const N = Math.max(targetN(k), 1);
  const fixedN = live.reduce((a, c) => a + c.fixed.length, 0);
  const total = live.reduce((a, c) => a + c.w, 0);
  // targets per landmass by weighted area, at least one each; extra landmasses beyond N are dropped smallest first
  live.sort((a, b) => b.w - a.w);
  while (live.length > Math.max(N, fixedN) && live.length > 1) { const x = live.pop(); if (x.fixed.length) { live.push(x); break; } x.drop = true; for (const c of x.cells) cty[c] = 0; }
  const rem = Math.max(N, fixedN) - live.length;
  const tw = live.reduce((a, c) => a + c.w, 0);
  const raw = live.map((c) => 1 + (rem * c.w) / tw);
  const tgt = raw.map((r) => Math.floor(r));
  let left = Math.max(N, fixedN) - tgt.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let q = 0; left > 0; q = (q + 1) % order.length, left--) tgt[order[q][1]]++;
  live.forEach((cp, ci) => { cp.target = Math.max(tgt[ci], cp.fixed.length); });
  ct.live = live;
}
lap('allocated');

// ---------- seeds inside each landmass ----------
const cx = (c) => mx(lonOf(c % W) + CELL / 2), cyy = (c) => my(latOf(Math.floor(c / W)) - CELL / 2);
for (let k = 0; k < countries.length; k++) {
  const ct = countries[k];
  const rng = mulberry32(hashStr(ct.code));
  for (const cp of ct.live) {
    const seeds = cp.fixed.map((f) => ({ x: f.x, y: f.y, fixed: f }));
    const nRural = cp.target - cp.fixed.length;
    const cells = cp.cells;
    const xs = new Float64Array(cells.length), ys = new Float64Array(cells.length);
    for (let q = 0; q < cells.length; q++) { xs[q] = cx(cells[q]); ys[q] = cyy(cells[q]); }
    // k-means++ start
    const ws = new Float64Array(cells.length);
    for (let q = 0; q < cells.length; q++) ws[q] = weightOfCell(cells[q], ct.code);
    const dmin = new Float64Array(cells.length).fill(Infinity);
    const upd = (sx, sy) => { for (let q = 0; q < cells.length; q++) { const d = (xs[q] - sx) ** 2 + (ys[q] - sy) ** 2; if (d < dmin[q]) dmin[q] = d; } };
    for (const s of seeds) upd(s.x, s.y);
    for (let r = 0; r < nRural; r++) {
      let sum = 0; for (let q = 0; q < cells.length; q++) sum += seeds.length ? dmin[q] * ws[q] : 1;
      let pick = rng() * sum, q = 0;
      if (!seeds.length) q = Math.floor(rng() * cells.length);
      else { for (; q < cells.length - 1; q++) { pick -= dmin[q] * ws[q]; if (pick <= 0) break; } }
      const s = { x: xs[q], y: ys[q], fixed: null }; seeds.push(s); upd(s.x, s.y);
    }
    // Lloyd iterations on the rural seeds
    if (nRural > 0) {
      const owner = new Int32Array(cells.length);
      for (let it = 0; it < 7; it++) {
        const sx = new Float64Array(seeds.length), sy = new Float64Array(seeds.length), sn = new Float64Array(seeds.length);
        for (let q = 0; q < cells.length; q++) {
          let b = 0, bd = Infinity;
          for (let s = 0; s < seeds.length; s++) { const d = (xs[q] - seeds[s].x) ** 2 + (ys[q] - seeds[s].y) ** 2; if (d < bd) { bd = d; b = s; } }
          owner[q] = b; sx[b] += xs[q] * ws[q]; sy[b] += ys[q] * ws[q]; sn[b] += ws[q];
        }
        for (let s = 0; s < seeds.length; s++) if (!seeds[s].fixed && sn[s] > 0) { seeds[s].x = sx[s] / sn[s]; seeds[s].y = sy[s] / sn[s]; }
      }
    }
    cp.seeds = seeds;
  }
}
lap('k-means done');

// ---------- terrain ----------
const nearLine = (lon, lat, pts, w) => {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((lon - ax) * dx + (lat - ay) * dy) / l2));
    if (Math.hypot(lon - (ax + t * dx), lat - (ay + t * dy)) <= w) return true;
  }
  return false;
};
const rect = (lon, lat, [a, b, c, d]) => lon >= a && lon <= b && lat >= c && lat <= d;
const MOUNTAIN_LINES = [
  [[[-122, 57], [-115, 50], [-110, 43], [-106, 36]], 2.6], [[[-124, 49], [-121.5, 44], [-120, 38]], 1.2], [[[-155, 60], [-148, 62], [-140, 61]], 2.2],
  [[[-105, 31], [-107, 25], [-104, 19], [-98, 17]], 1.8], [[[-77, 8], [-77, 0], [-78, -5], [-76, -12], [-71, -17], [-69, -22], [-69.5, -30], [-70.5, -38], [-72, -48], [-73, -54]], 2.1],
  [[[5, 44], [8, 46], [13, 47], [16, 47]], 1.6], [[[-2, 43], [3, 42.5]], 0.9], [[[18, 49.5], [22, 49], [25, 47.5], [25, 45.5], [22, 45]], 1.1], [[[37, 44], [43, 43], [48, 41.5]], 1.4],
  [[[73, 35], [80, 31], [88, 28], [97, 28]], 2.4], [[[70, 40], [80, 43], [87, 48], [95, 50]], 2.6], [[[68, 37], [72, 35]], 1.6], [[[46, 35], [50, 31], [55, 27]], 2.0], [[[30, 37], [37, 37.5], [42, 38]], 1.4],
  [[[7, 59], [8, 63], [14, 66], [18, 68], [22, 70]], 2.0], [[[-9, 31], [-2, 33], [3, 35], [9, 36]], 1.4], [[[29, -25], [29, -30], [27, -31]], 1.4], [[[137, 35], [138, 37]], 1.3],
  [[[104, 22], [107, 16], [108, 12]], 1.1], [[[93, 26], [97, 22], [98, 17]], 1.5], [[[98, 3], [101, -1], [104, -4]], 1.0], [[[142, -5.5], [147, -6.5]], 2.0], [[[125, 70], [135, 63], [145, 60]], 2.6],
  [[[134, 47], [138, 52]], 1.0], [[[36, 13], [39, 8], [41, 6]], 2.4], [[[-84, 10], [-86, 13], [-90, 15]], 1.3], [[[60, 68], [59, 60], [58, 55], [58, 52]], 1.1],
];
const MOUNTAIN_RECTS = [[80, 100, 28, 36], [98, 104, 24, 32], [60, 75, 30, 37], [-9, -6, 36, 43], [38, 44, 38, 41]];
const DESERT_RECTS = [[-17, 35, 15, 31], [35, 58, 14, 29], [53, 62, 28, 35], [53, 68, 37, 46], [95, 115, 38, 46], [77, 90, 37, 41.5], [68, 74, 24, 29], [120, 142, -31, -19], [-71, -68, -27, -18],
  [14, 26, -28, -18], [-116, -104, 26, 35], [41, 51, -1, 11], [34, 44, 28, 33], [-72, -60, -33, -26]];
const FOREST_RECTS = [[-75, -50, -10, 4], [10, 30, -6, 5], [95, 140, -8, 8], [-92, -75, 8, 18], [-12, 10, 4, 8], [-125, -121, 42, 50], [130, 146, 33, 44], [97, 108, 10, 22], [88, 97, 22, 28], [-90, -78, 24, 32],
  [-84, -76, 36, 44], [8, 20, 47, 51], [13, 30, 52, 58], [-55, -40, -30, -22], [10, 14, 7, 12]];
const HILL_RECTS = [[-84, -72, 35, 46], [-50, -40, -24, -12], [74, 82, 14, 20], [-6, -3, 56, 58.5], [145, 152, -37, -17], [-5, 5, 43, 49], [14, 26, 43, 49], [0, 4, 50, 54], [24, 30, 36, 40], [18, 28, 41, 45], [-9, 1, 36, 41]];
function terrainAt(lon, lat) {
  for (const [pts, w] of MOUNTAIN_LINES) if (nearLine(lon, lat, pts, w)) return 'M';
  for (const r of MOUNTAIN_RECTS) if (rect(lon, lat, r)) return 'M';
  for (const r of DESERT_RECTS) if (rect(lon, lat, r)) return 'D';
  for (const r of FOREST_RECTS) if (rect(lon, lat, r)) return 'F';
  if (lat >= 56 && lat <= 69 && (lon < -50 || lon > 4)) return 'F';
  if (lat >= 52 && lat < 56 && lon > 25 && lon < 140) return 'F';
  for (const r of HILL_RECTS) if (rect(lon, lat, r)) return 'H';
  return 'P';
}

// ---------- provinces: names, resources, terrain ----------
const SUFFIX = { P: ['Plains', 'Farmland', 'Lowlands'], F: ['Woods', 'Forest', 'Woodlands'], H: ['Hills', 'Uplands', 'Downs'], M: ['Highlands', 'Mountains', 'Ranges'], D: ['Desert', 'Wastes', 'Badlands'] };
const dirName = (dx, dy) => { // dy is map y (down)
  const a = Math.atan2(-dy, dx) * 180 / Math.PI; // east = 0, north = 90
  const dirs = ['East', 'North-East', 'North', 'North-West', 'West', 'South-West', 'South', 'South-East'];
  return dirs[Math.round(((a + 360) % 360) / 45) % 8];
};
const idxOfProvince = [];
for (let k = 0; k < countries.length; k++) {
  const ct = countries[k];
  ct.provIdx = [];
  const allFixed = [];
  for (const cp of ct.live) for (const s of cp.seeds) if (s.fixed) allFixed.push(s);
  const usedNames = new Set();
  const suffixUse = new Map();
  for (const cp of ct.live) {
    for (const s of cp.seeds) {
      const idx = provs.length;
      const lon = LON0 + s.x / SX, lat = LAT1 - s.y / SY;
      const f = s.fixed;
      s.pidx = idx;
      const p = { idx, code: ct.code, comp: cp.id, x: s.x, y: s.y, lon, lat, city: !!(f && f.city), res: f ? f.res : undefined, doubled: !!(f && f.doubled), capital: !!(f && f.capital), terrain: terrainAt(lon, lat), name: f ? f.name : '' };
      provs.push(p); ct.provIdx.push(idx);
    }
  }
  // rural names: nearest city (or capital) + terrain word, with a compass word when that is taken
  const named = ct.provIdx.map((i) => provs[i]).filter((p) => p.name);
  const nameSet = new Set(named.map((p) => p.name));
  const anchors = ct.provIdx.map((i) => provs[i]).filter((p) => p.city);
  const rural = ct.provIdx.map((i) => provs[i]).filter((p) => !p.name);
  rural.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const p of rural) {
    let a = anchors[0], bd = Infinity;
    for (const q of anchors) { const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (d < bd) { bd = d; a = q; } }
    const base = a ? a.name : ct.name;
    const words = SUFFIX[p.terrain];
    let nm = `${base} ${words[0]}`;
    if (nameSet.has(nm)) { const dir = a ? dirName(p.x - a.x, p.y - a.y) : 'Outer'; nm = `${dir} ${base} ${words[0]}`; }
    if (nameSet.has(nm)) { nm = `${base} ${words[1]}`; }
    if (nameSet.has(nm)) { const dir = a ? dirName(p.x - a.x, p.y - a.y) : 'Outer'; nm = `${dir} ${base} ${words[1]}`; }
    let n = 2; const root = nm; while (nameSet.has(nm)) nm = `${root} ${n++}`;
    nameSet.add(nm); p.name = nm;
  }
  // fill resource gaps for playable countries and make sure everyone has at least a little food
  if (ct.playable) {
    const cities = ct.provIdx.map((i) => provs[i]).filter((p) => p.city && !p.capital);
    const have = () => { const h = new Set(); for (const i of ct.provIdx) if (provs[i].res) h.add(provs[i].res); return h; };
    for (const need of ['o', 's', 'e', 'r', 'w']) {
      if (have().has(need)) continue;
      const counts = new Map(); for (const i of ct.provIdx) if (provs[i].res) counts.set(provs[i].res, (counts.get(provs[i].res) ?? 0) + 1);
      const pool = cities.filter((p) => !p.doubled && (p.res === 'f' || (counts.get(p.res) ?? 0) > 1));
      const t = pool.length ? pool[Math.floor(rng0() * pool.length)] : cities[0];
      if (!t) { warn.push(`${ct.name}: cannot give ${need}`); continue; }
      console.log(`  filled ${RES[need]} for ${ct.name}: ${t.name} (was ${t.res})`);
      t.res = need;
    }
  }
}
// unique names across the whole world (keys must be unique)
{
  const seenKeys = new Map();
  for (const p of provs) {
    let k = slug(p.name); let name = p.name;
    if (seenKeys.has(k)) { name = `${p.name}`; k = `${slug(p.name)}_${p.code.toLowerCase()}`; }
    let n = 2; const root = k; while (seenKeys.has(k)) k = `${root}_${n++}`;
    seenKeys.set(k, p.idx); p.key = k; p.name = name;
  }
}
lap(`${provs.length} provinces`);

// ---------- paint the province raster ----------
const land = new Uint8Array(W * H);
for (let c = 0; c < W * H; c++) land[c] = cty[c] ? 1 : 0;
const reg = new Int16Array(W * H).fill(-1);
for (let k = 0; k < countries.length; k++) {
  for (const cp of countries[k].live) {
    const base = cp.seeds.map((s) => ({ s, idx: s.pidx }));
    for (const c of cp.cells) {
      if (!cty[c]) continue;
      const x = cx(c), y = cyy(c);
      let b = -1, bd = Infinity;
      for (const { s, idx } of base) { const d = (s.x - x) ** 2 + (s.y - y) ** 2; if (d < bd) { bd = d; b = idx; } }
      reg[c] = b;
    }
  }
}
const seeds = provs; // provinces, same indexing as reg
lap('province raster');


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
{ let n = 0; const ex = []; for (let c = 0; c < W * H; c++) if (cty[c] && reg[c] < 0) { n++; if (ex.length < 8) ex.push([lonOf(c % W).toFixed(1), latOf(Math.floor(c / W)).toFixed(1), countries[cty[c] - 1].code]); } console.log('land cells without province:', n, JSON.stringify(ex)); }

const cellCount = new Map();
for (let c = 0; c < W * H; c++) if (reg[c] >= 0) cellCount.set(reg[c], (cellCount.get(reg[c]) ?? 0) + 1);
const missing = seeds.filter((s) => !cellCount.has(s.idx));
if (missing.length) { console.error('provinces with no land:', missing.map((m) => m.name).join(', ')); process.exit(1); }
const tiny = seeds.filter((s) => cellCount.get(s.idx) < 3);
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
  if (closed && pts.length <= 6) {
    // a one-cell island keeps its square
  } else if (closed && pts.length > 6) {
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
lap('adjacency');

// ---------- landmasses and ferry candidates ----------
const landComp = new Int32Array(W * H).fill(-1);
let landCount = 0;
for (let s = 0; s < W * H; s++) {
  if (reg[s] < 0 || landComp[s] >= 0) continue;
  const st = [s]; landComp[s] = landCount;
  while (st.length) {
    const c = st.pop(); const ci = c % W, cj = (c - ci) / W;
    for (const [di, dj] of N4) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni;
      if (reg[n] >= 0 && landComp[n] < 0) { landComp[n] = landCount; st.push(n); }
    }
  }
  landCount++;
}
const provLand = new Int32Array(seeds.length).fill(-1);
for (let c = 0; c < W * H; c++) if (reg[c] >= 0) provLand[reg[c]] = landComp[c];
const samples = [];
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const r = reg[j * W + i];
  if (r < 0 || ((i * 7 + j * 13) % 3 !== 0 && cellCount.get(r) > 30)) continue;
  if (N4.some(([di, dj]) => { const ni = i + di, nj = j + dj; return ni >= 0 && nj >= 0 && ni < W && nj < H && reg[nj * W + ni] < 0; })) samples.push({ i, j, p: r, l: landComp[j * W + i] });
}
const BK = 16;
const buckets = new Map();
samples.forEach((s, n) => { const k = `${Math.floor(s.i / BK)},${Math.floor(s.j / BK)}`; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(n); });
const gap = new Map(); // "a|b" -> min distance in cells (provinces on different landmasses)
const GAP_MAX = 24;
for (const s of samples) {
  const bi = Math.floor(s.i / BK), bj = Math.floor(s.j / BK);
  for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
    const list = buckets.get(`${bi + di},${bj + dj}`); if (!list) continue;
    for (const n of list) {
      const t = samples[n];
      if (t.l === s.l || t.p < s.p) continue;
      const d = Math.hypot(t.i - s.i, t.j - s.j);
      if (d > GAP_MAX) continue;
      const k = `${s.p}|${t.p}`; if (!(gap.get(k) <= d)) gap.set(k, d);
    }
  }
}
const ferryCand = []; // [a, b, d]
{
  const groups = new Map();
  for (const [k, d] of gap) { const [a, b] = k.split('|').map(Number); const la = provLand[a], lb = provLand[b]; const g = la < lb ? `${la}|${lb}` : `${lb}|${la}`; if (!groups.has(g)) groups.set(g, []); groups.get(g).push([a, b, d]); }
  for (const list of groups.values()) {
    list.sort((p, q) => p[2] - q[2]);
    const used = new Set(); let taken = 0;
    for (const [a, b, d] of list) { if (used.has(a) || used.has(b)) continue; used.add(a); used.add(b); ferryCand.push([a, b, d]); if (++taken >= 2) break; }
  }
  // landmasses with no neighbour within reach: link the closest pair anywhere
  const linked = new Set(); for (const [a, b] of ferryCand) { linked.add(provLand[a]); linked.add(provLand[b]); }
  const landSizes = new Map(); for (const s of samples) landSizes.set(s.l, (landSizes.get(s.l) ?? 0) + 1);
  for (const l of landSizes.keys()) {
    if (linked.has(l)) continue;
    let best = null, bd = Infinity;
    const mine = samples.filter((s) => s.l === l);
    for (const t of samples) { if (t.l === l) continue; for (const s of mine) { const d = Math.hypot(t.i - s.i, t.j - s.j); if (d < bd) { bd = d; best = [s.p, t.p]; } } }
    if (best && bd < 72) { ferryCand.push([best[0], best[1], bd]); linked.add(l); linked.add(provLand[best[1]]); }
  }
}
lap(`${landCount} landmasses, ${ferryCand.length} ferry candidates`);


// ---------- sea lanes: a net of dots over the ocean ----------
const STEP = 16; // grid cells between dots (4 degrees)
// Only real seas count: lakes (Great Lakes, Baikal) and bays closed off by a one-cell neck are not.
const waterLabel = new Int32Array(W * H).fill(-1);
const waterSize = [];
for (let s0 = 0; s0 < W * H; s0++) {
  if (reg[s0] >= 0 || waterLabel[s0] >= 0) continue;
  let n = 0; const st = [s0]; waterLabel[s0] = waterSize.length;
  while (st.length) {
    const c = st.pop(); n++; const ci = c % W, cj = (c - ci) / W;
    for (const [di, dj] of N4) { const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue; const q = nj * W + ni; if (reg[q] < 0 && waterLabel[q] < 0) { waterLabel[q] = waterSize.length; st.push(q); } }
  }
  waterSize.push(n);
}
const isSea = (i, j) => i >= 0 && j >= 0 && i < W && j < H && reg[j * W + i] < 0 && waterSize[waterLabel[j * W + i]] >= 300;
const nodeAt = new Map();
const seaNodes = [];
for (let j = 4; j < H; j += STEP) for (let i = 4; i < W; i += STEP) {
  if (!isSea(i, j)) continue;
  nodeAt.set(`${i},${j}`, seaNodes.length);
  seaNodes.push([i, j]);
}
const clearLine = (i0, j0, i1, j1) => {
  const n = Math.max(Math.abs(i1 - i0), Math.abs(j1 - j0)) * 2;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (!isSea(Math.round(i0 + (i1 - i0) * t), Math.round(j0 + (j1 - j0) * t))) return false;
  }
  return true;
};
const seaLinks = [];
const seaAdj = seaNodes.map(() => []);
seaNodes.forEach(([i, j], a) => {
  for (const [di, dj] of [[STEP, 0], [0, STEP], [STEP, STEP], [STEP, -STEP]]) {
    const b = nodeAt.get(`${i + di},${j + dj}`);
    if (b === undefined || !clearLine(i, j, i + di, j + dj)) continue;
    seaLinks.push([a, b]); seaAdj[a].push(b); seaAdj[b].push(a);
  }
});
// province -> the dots its ships can reach (sea next to the coast, straight line out of the province)
const portsOf = new Map(); // idx -> node indices
const coastCells = new Map(); // idx -> sea cells touching the province
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const r = reg[j * W + i];
  if (r < 0) continue;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (isSea(i + di, j + dj)) { if (!coastCells.has(r)) coastCells.set(r, []); coastCells.get(r).push([i + di, j + dj]); }
  }
}
// every coastal province gets a harbour dot just off its coast (the sea cell nearest its centre that is two cells from land)
const gridCount = seaNodes.length;
for (const t of seeds) {
  const cells = coastCells.get(t.idx);
  if (!cells) continue;
  const [cxm, cym] = centers.get(t.idx);
  const ci = (cxm / SX) / CELL, cj = (cym / SY) / CELL;
  const open = cells.filter(([i, j]) => [[3, 0], [-3, 0], [0, 3], [0, -3]].every(([di, dj]) => isSea(i + di, j + dj) || reg[(j + dj) * W + i + di] === t.idx));
  const pool = open.length ? open : cells;
  pool.sort((p, q) => Math.hypot(p[0] - ci, p[1] - cj) - Math.hypot(q[0] - ci, q[1] - cj));
  const [pi, pj] = pool[0];
  const id = seaNodes.length;
  seaNodes.push([pi, pj]); seaAdj.push([]);
  portsOf.set(t.idx, [id]);
}
// link every harbour dot (and its neighbours) to the nearest dots it can see over open water
for (let a = gridCount; a < seaNodes.length; a++) {
  const [ai, aj] = seaNodes[a];
  const cand = seaNodes.map((n, k) => ({ k, d: Math.hypot(n[0] - ai, n[1] - aj) })).filter((o) => o.k !== a && o.d <= 72).sort((p, q) => p.d - q.d);
  let linked = 0;
  for (const o of cand) {
    if (!clearLine(ai, aj, seaNodes[o.k][0], seaNodes[o.k][1])) continue;
    if (seaAdj[a].includes(o.k)) continue;
    seaLinks.push([a, o.k]); seaAdj[a].push(o.k); seaAdj[o.k].push(a);
    if (++linked >= 6) break;
  }
}
// keep only the biggest connected body of water
const seaComp = new Int32Array(seaNodes.length).fill(-1);
const seaCompSize = [];
for (let s0 = 0; s0 < seaNodes.length; s0++) {
  if (seaComp[s0] >= 0) continue;
  let n = 0; const st = [s0]; seaComp[s0] = seaCompSize.length;
  while (st.length) { const c = st.pop(); n++; for (const d of seaAdj[c]) if (seaComp[d] < 0) { seaComp[d] = seaCompSize.length; st.push(d); } }
  seaCompSize.push(n);
}
const keepNode = (k) => seaCompSize[seaComp[k]] >= 2; // drop single dots
const nodeXY = (k) => { const [i, j] = seaNodes[k]; return [mx(lonOf(i) + CELL / 2), my(latOf(j) - CELL / 2)]; };
function seaPath(pa, pb) { // dijkstra between the port dots of two provinces; returns node list
  const A = (portsOf.get(pa) ?? []).filter(keepNode), B = (portsOf.get(pb) ?? []).filter(keepNode);
  if (!A.length || !B.length) return null;
  const goal = new Set(B);
  const d = new Map(), prev = new Map(), done = new Set();
  const hyp = (x, y) => Math.hypot(nodeXY(x)[0] - nodeXY(y)[0], nodeXY(x)[1] - nodeXY(y)[1]);
  for (const a of A) d.set(a, 0);
  for (;;) {
    let cur = -1, best = Infinity;
    for (const [k, v] of d) if (!done.has(k) && v < best) { best = v; cur = k; }
    if (cur < 0) return null;
    if (goal.has(cur)) { const out = [cur]; while (prev.has(out[0])) out.unshift(prev.get(out[0])); return out; }
    done.add(cur);
    for (const nb of seaAdj[cur]) { const c = best + hyp(cur, nb); if (c < (d.get(nb) ?? Infinity)) { d.set(nb, c); prev.set(nb, cur); } }
  }
}

// ---------- ferries and roads ----------
const cen = (i) => centers.get(i);
const dist = (a, b) => Math.hypot(cen(a)[0] - cen(b)[0], cen(a)[1] - cen(b)[1]);
const ek = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const ferrySet = new Set();
for (const [a, b, d] of ferryCand) {
  if (!seaPath(a, b) && d > 12) continue; // short hops over a strait are kept even when the sea net cannot route them
  ferrySet.add(ek(a, b)); link(a, b); link(b, a);
}
if (process.env.DBG_ISO) for (const t of seeds) if (!(adj.get(t.idx)?.size)) {
  const cand = ferryCand.filter(([a, b]) => a === t.idx || b === t.idx);
  const nb = new Set(); for (let c = 0; c < W * H; c++) if (reg[c] === t.idx) { const ci = c % W, cj = (c - ci) / W; for (const [di, dj] of N4) { const q = (cj + dj) * W + ci + di; if (reg[q] < 0) nb.add(waterSize[waterLabel[q]]); } }
  console.log('ISO', t.name, 'cells', cellCount.get(t.idx), 'land', provLand[t.idx], 'cands', JSON.stringify(cand), 'ports', JSON.stringify(portsOf.get(t.idx)), 'keep', (portsOf.get(t.idx) ?? []).map(keepNode), 'water', [...nb]);
}
const edgeList = [];
for (const [a, set] of adj) for (const b of set) if (a < b) edgeList.push([a, b]);
const capitals = new Set(seeds.filter((s) => s.capital).map((s) => s.idx));
const roads = edgeList.map(([a, b]) => {
  const k = ek(a, b);
  const kind = ferrySet.has(k) ? 'ferry' : capitals.has(a) || capitals.has(b) ? 'highway' : 'road';
  return [a, b, kind];
});

// shared-border midpoint for land roads; sea path for ferries
const viaOf = new Map();
const near = (p, q) => Math.abs(p[0] - q[0]) < 0.05 && Math.abs(p[1] - q[1]) < 0.05;
for (const [a, b, kind] of roads) {
  const k = ek(a, b);
  if (kind === 'ferry') {
    const path = seaPath(a, b);
    if (path) {
      const pts = path.filter((_, i) => i % 2 === 0 || i === path.length - 1).map(nodeXY);
      viaOf.set(k, pts.flat());
    } else if (dist(a, b) > 600) {
      // Across the map edge (the Pacific): the lane leaves one side and re-enters on the other.
      const exitX = (i) => (cen(i)[0] < MAP_W / 2 ? 0 : MAP_W);
      viaOf.set(k, [exitX(a), cen(a)[1], exitX(b), cen(b)[1]]);
    } else viaOf.set(k, []);
    continue;
  }
  const pa = polygons.get(a), pb = polygons.get(b);
  const shared = pa.map((p) => pb.some((q) => near(p, q)));
  // longest cyclic run of shared vertices
  let bestRun = [], run = [];
  for (let q = 0; q < pa.length * 2; q++) {
    const idx = q % pa.length;
    if (shared[idx]) { run.push(idx); if (run.length > pa.length) break; } else { if (run.length > bestRun.length) bestRun = run; run = []; }
  }
  if (run.length > bestRun.length) bestRun = run;
  if (bestRun.length === 0) { viaOf.set(k, []); continue; }
  let total = 0; const segs = [];
  for (let q = 1; q < bestRun.length; q++) { const l = Math.hypot(pa[bestRun[q]][0] - pa[bestRun[q - 1]][0], pa[bestRun[q]][1] - pa[bestRun[q - 1]][1]); segs.push(l); total += l; }
  let acc = 0, via = pa[bestRun[0]];
  for (let q = 0; q < segs.length; q++) {
    if (acc + segs[q] >= total / 2) { const t = segs[q] ? (total / 2 - acc) / segs[q] : 0; const p0 = pa[bestRun[q]], p1 = pa[bestRun[q + 1]]; via = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]; break; }
    acc += segs[q];
  }
  viaOf.set(k, via);
}
if (process.env.DBG_PORT) { const t = seeds.find((x) => x.name === process.env.DBG_PORT); const ex = new Set(); for (const e of edges) if (e.r === t.idx && e.n < 0) { const [i, j] = [e.a % VW, Math.floor(e.a / VW)]; ex.add(`${lonOf(i).toFixed(2)},${latOf(j).toFixed(2)}`); } console.log('DBGPORT', t.name, t.code, [...ex].slice(0, 6), 'ports', portsOf.get(t.idx), (portsOf.get(t.idx) ?? []).map(keepNode)); }
console.log("provinces without a usable port:", seeds.filter((t) => coastal.has(t.idx) && !(portsOf.get(t.idx) ?? []).some(keepNode)).map((t) => t.name).join(", "));
if (0) console.log('ferries without sea path:', roads.filter(([a,b,k]) => k==='ferry' && viaOf.get(ek(a,b)).length===0).map(([a,b])=>seeds[a].name+'-'+seeds[b].name).join(','));
console.log(`sea dots: ${seaNodes.filter((_, k) => keepNode(k)).length}, ports for ${portsOf.size}/${coastal.size} coastal provinces`);


// ---------- output ----------
const keyOf = (s) => s.key;
const round = (n) => Math.round(n * 10) / 10;
const TERR = { P: 'plains', F: 'forest', H: 'hills', M: 'mountains', D: 'desert' };
const rows = seeds.map((s) => ({
  key: s.key,
  name: s.name,
  countryCode: s.code,
  terrain: TERR[s.terrain],
  isCity: s.city || undefined,
  deposit: s.res ? RES[s.res] : undefined,
  doubled: s.doubled || undefined,
  isCapital: s.capital,
  isCoastal: coastal.has(s.idx) && (portsOf.get(s.idx) ?? []).some(keepNode),
  center: centers.get(s.idx).map(round),
  polygon: polygons.get(s.idx).flatMap(([x, y]) => [round(x), round(y)]),
  adjacent: [...(adj.get(s.idx) ?? [])].map((i) => keyOf(seeds[i])).sort(),
}));

let problems = 0;
for (const r of rows) {
  if (r.adjacent.length === 0) { console.warn('isolated province:', r.name, r.countryCode); problems++; }
  if (!polygons.get(seeds.find((s) => s.key === r.key).idx)) { console.warn('no polygon:', r.name); problems++; }
}
const r1 = (n) => Math.round(n * 10) / 10;
const roadRows = roads.map(([a, b, kind]) => [keyOf(seeds[a]), keyOf(seeds[b]), kind, viaOf.get(ek(a, b)).map(r1)]).sort();
const mainDots = seaNodes.map((_, k) => k).filter(keepNode);
const remap = new Map(mainDots.map((k, n) => [k, n]));
const seaOut = {
  nodes: mainDots.flatMap((k) => nodeXY(k).map(r1)),
  links: seaLinks.filter(([a, b]) => remap.has(a) && remap.has(b)).flatMap(([a, b]) => [remap.get(a), remap.get(b)]),
  ports: [...portsOf].filter(([, ks]) => ks.some((k) => remap.has(k))).map(([idx, ks]) => [keyOf(seeds[idx]), ...ks.filter((k) => remap.has(k)).map((k) => remap.get(k))]),
};
console.log(`roads: ${roadRows.length} (adjacencies: ${edgeList.length}, ferries ${roadRows.filter((r) => r[2] === 'ferry').length}, highways ${roadRows.filter((r) => r[2] === 'highway').length})`);

// country table
const hsl = (h, s, l) => { s /= 100; l /= 100; const a = s * Math.min(l, 1 - l); const f = (n) => { const k = (n + h / 30) % 12; const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, '0'); }; return `#${f(0)}${f(8)}${f(4)}`; };
const countryRows = countries.filter((ct) => ct.provIdx.length > 0).map((ct) => {
  const sp = ct.spec;
  const cap = seeds[ct.provIdx.find((i) => seeds[i].capital)];
  return {
    code: ct.code,
    name: ct.name,
    color: sp ? sp.color : hsl(hashStr(ct.code) % 360, 32, 52),
    playable: !!sp,
    tier: sp ? sp.tier : 'minor',
    capitalName: cap.name,
    blurb: sp ? sp.blurb : 'AI-controlled.',
    startBonus: sp ? sp.bonus : undefined,
    provinces: ct.provIdx.length,
  };
}).sort((a, b) => (b.playable - a.playable) || a.name.localeCompare(b.name));

const out = `// GENERATED by packages/shared/scripts/generate-map.mjs. Do not edit by hand.
export const MAP_WIDTH = ${MAP_W};
export const MAP_HEIGHT = ${MAP_H};

export type GeneratedResource = 'food' | 'oil' | 'steel' | 'electronics' | 'rare' | 'wood';

export interface GeneratedProvince {
  key: string;
  name: string;
  countryCode: string;
  terrain: 'plains' | 'forest' | 'hills' | 'mountains' | 'desert';
  /** Cities produce manpower, money and one resource; ordinary provinces produce manpower and money only. */
  isCity?: boolean;
  /** The resource this province produces: a city's resource, or the resource of a deposit province. */
  deposit?: GeneratedResource;
  /** A deposit province (not a city): produces its resource at double rate. */
  doubled?: boolean;
  isCapital: boolean;
  isCoastal: boolean;
  center: [number, number];
  polygon: number[];
  adjacent: string[];
}

export interface GeneratedCountry {
  code: string;
  name: string;
  color: string;
  playable: boolean;
  tier: 'super' | 'major' | 'medium' | 'minor';
  capitalName: string;
  blurb: string;
  startBonus?: Partial<Record<'money' | 'food' | 'oil' | 'steel' | 'electronics' | 'rare' | 'wood' | 'manpower', number>>;
  provinces: number;
}

export const GENERATED_COUNTRIES: GeneratedCountry[] = ${JSON.stringify(countryRows)};

export const GENERATED_PROVINCES: GeneratedProvince[] = ${JSON.stringify(rows)};

/** Roads between neighbouring provinces: [a, b, kind]. Ferries are the sea lanes between landmasses. */
export const GENERATED_ROADS: [string, string, 'highway' | 'road' | 'ferry', number[]][] = ${JSON.stringify(roadRows)};

/** Dots over the ocean that ships sail along: flat [x,y,...] nodes, flat [a,b,...] links, and the dots each coastal province opens onto. */
export const GENERATED_SEA: { nodes: number[]; links: number[]; ports: (string | number)[][] } = ${JSON.stringify(seaOut)};
`;
writeFileSync(join(here, '..', 'src', 'map-geometry.generated.ts'), out);
console.log(`provinces: ${rows.length}, countries: ${countryRows.length}, size ${(out.length / 1024).toFixed(0)} KB, problems ${problems}`);
for (const w of warn) console.warn('warning:', w);

// ---------- per-country report ----------
console.log('\nplayable countries:');
for (const c of countryRows.filter((c) => c.playable)) {
  const ps = rows.filter((r) => r.countryCode === c.code);
  const cities = ps.filter((p) => p.isCity), dep = ps.filter((p) => p.doubled);
  const res = {}; for (const p of ps) if (p.deposit) res[p.deposit] = (res[p.deposit] ?? 0) + 1;
  console.log(`  ${c.code} ${c.name}: ${ps.length} provinces, ${cities.length} cities, ${dep.length} deposits, resources ${JSON.stringify(res)}`);
}
console.log(`AI countries: ${countryRows.filter((c) => !c.playable).length}, AI provinces: ${rows.filter((r) => !countryRows.find((c) => c.code === r.countryCode).playable).length}`);

// ---------- debug picture ----------
const dbg = process.argv.indexOf('--debug');
if (dbg > 0) {
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_W} ${MAP_H}" width="${MAP_W}" height="${MAP_H}"><rect width="100%" height="100%" fill="#16324a"/>`];
  const colorOf = new Map(countryRows.map((c) => [c.code, c.color]));
  rows.forEach((r, k) => {
    const pts = [];
    for (let q = 0; q < r.polygon.length; q += 2) pts.push(`${r.polygon[q]},${r.polygon[q + 1]}`);
    parts.push(`<polygon points="${pts.join(' ')}" fill="${colorOf.get(r.countryCode)}" fill-opacity="${r.isCity ? 0.95 : 0.72}" stroke="#0b1d2e" stroke-width="0.7"/>`);
  });
  const resColor = { food: '#e8d25a', oil: '#222', steel: '#9aa', electronics: '#4be36b', rare: '#ff9a2e', wood: '#8a5a2b' };
  rows.forEach((r) => {
    if (r.isCity) parts.push(`<circle cx="${r.center[0]}" cy="${r.center[1]}" r="${r.isCapital ? 5 : 3.5}" fill="${resColor[r.deposit] ?? '#fff'}" stroke="#000" stroke-width="0.8"/>`);
    if (r.doubled) parts.push(`<rect x="${r.center[0] - 4}" y="${r.center[1] - 4}" width="8" height="8" fill="${resColor[r.deposit]}" stroke="#000" stroke-width="0.8" transform="rotate(45 ${r.center[0]} ${r.center[1]})"/>`);
  });
  for (const [a, b, kind, via] of roadRows) if (kind === 'ferry') {
    const A = rows.find((r) => r.key === a), B = rows.find((r) => r.key === b);
    parts.push(`<polyline points="${A.center.join(',')} ${via.join(' ').replace(/(\S+) (\S+)/g, '$1,$2')} ${B.center.join(',')}" fill="none" stroke="#fff" stroke-dasharray="4 3" stroke-width="0.8" opacity="0.7"/>`);
  }
  parts.push('</svg>');
  writeFileSync(process.argv[dbg + 1], parts.join('\n'));
}
