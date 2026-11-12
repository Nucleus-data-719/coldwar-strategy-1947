import { Container, Graphics, Text } from 'pixi.js';
import { PROVINCES, PROVINCE_BY_KEY } from '@cw/shared';

/**
 * The zoomed-out map, like the strategic view of Hearts of Iron IV: whole countries filled with one colour, thin
 * country borders and a big name laid across each country. The 2,000-odd province shapes, roads and icons are not
 * drawn at all while this is showing, which is what keeps the map fast when the whole world is on screen.
 *
 * It is rebuilt only when province ownership changes, from the polygons the provinces already have.
 */

export interface StrategicCountry {
  id: string;
  name: string;
  color: number;
  /** Province to select when the country is clicked. */
  clickKey: string | null;
}

interface SharedEdge {
  a: number;
  b: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const q = (v: number) => Math.round(v * 10);

/** Edges used by two provinces: the borders between them. Built once. */
function buildSharedEdges(): SharedEdge[] {
  const seen = new Map<string, { p: number; x1: number; y1: number; x2: number; y2: number }>();
  const out: SharedEdge[] = [];
  PROVINCES.forEach((geo, p) => {
    const poly = geo.polygon;
    const n = poly.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x1 = poly[i * 2], y1 = poly[i * 2 + 1], x2 = poly[j * 2], y2 = poly[j * 2 + 1];
      const a = `${q(x1)},${q(y1)}`, b = `${q(x2)},${q(y2)}`;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const other = seen.get(key);
      if (other) {
        if (other.p !== p) out.push({ a: other.p, b: p, x1, y1, x2, y2 });
      } else seen.set(key, { p, x1, y1, x2, y2 });
    }
  });
  return out;
}

const indexByKey = new Map(PROVINCES.map((g, i) => [g.key, i]));

/** The largest group of touching provinces among `members`, so an overseas colony does not drag a country's name into the sea. */
function mainCluster(members: number[]): number[] {
  const inSet = new Set(members);
  const seen = new Set<number>();
  let best: number[] = [];
  for (const start of members) {
    if (seen.has(start)) continue;
    const comp: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const k of PROVINCES[cur].adjacent) {
        const ni = indexByKey.get(k);
        if (ni !== undefined && inSet.has(ni) && !seen.has(ni)) { seen.add(ni); stack.push(ni); }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return best;
}

export interface StrategicView {
  container: Container;
  /** Rebuilds the fills, borders and names if ownership or colours changed. owners[i] is the owner of PROVINCES[i]. */
  update: (owners: string[], countries: StrategicCountry[]) => void;
  /** Hides names that would be too small to read at this zoom. */
  syncLabels: (scale: number) => void;
}

export function createStrategicView(opts: { isDragging: () => boolean; onSelect: (key: string) => void }): StrategicView {
  const container = new Container();
  container.visible = false;
  const fills = new Container();
  const borderG = new Graphics();
  borderG.eventMode = 'none';
  const names = new Container();
  names.eventMode = 'none';
  container.addChild(fills, borderG, names);

  const edges = buildSharedEdges();
  let lastSig = '';
  let labels: { t: Text; size: number }[] = [];
  let scaleSeen = 0.5;

  const update = (owners: string[], countries: StrategicCountry[]) => {
    const sig = owners.join(',') + '|' + countries.map((c) => `${c.id}${c.color}`).join(',');
    if (sig === lastSig) return;
    lastSig = sig;
    for (const c of fills.removeChildren()) c.destroy();
    for (const c of names.removeChildren()) c.destroy();
    labels = [];
    borderG.clear();

    const byOwner = new Map<string, number[]>();
    owners.forEach((o, i) => {
      const list = byOwner.get(o);
      if (list) list.push(i);
      else byOwner.set(o, [i]);
    });
    const info = new Map(countries.map((c) => [c.id, c]));

    for (const [ownerId, members] of byOwner) {
      const c = info.get(ownerId);
      if (!c) continue;
      // fill: all of the country's provinces in one shape; a same-colour hairline hides the seams between them
      // each province is filled on its own: one fill over many touching polygons drops some of them
      const g = new Graphics();
      for (const i of members) g.poly(PROVINCES[i].polygon).fill({ color: c.color, alpha: 1 }).stroke({ width: 0.8, color: c.color, alpha: 1 });
      g.eventMode = 'static';
      g.cursor = 'pointer';
      const clickKey = c.clickKey ?? PROVINCES[members[0]].key;
      g.on('pointertap', () => { if (!opts.isDragging()) opts.onSelect(clickKey); });
      fills.addChild(g);

      // name: across the main landmass, along its long axis, sized to fit
      const main = mainCluster(members);
      if (main.length === 0) continue;
      let mx = 0, my = 0;
      for (const i of main) { mx += PROVINCES[i].center.x; my += PROVINCES[i].center.y; }
      mx /= main.length; my /= main.length;
      let sxx = 0, syy = 0, sxy = 0;
      for (const i of main) {
        const dx = PROVINCES[i].center.x - mx, dy = PROVINCES[i].center.y - my;
        sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
      }
      let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const elong = (sxx + syy + Math.hypot(sxx - syy, 2 * sxy)) / Math.max(1, sxx + syy - Math.hypot(sxx - syy, 2 * sxy));
      if (elong < 1.6 || main.length < 4) angle = 0; // roundish countries read better straight
      // tall, narrow countries (Chile, Italy) get steeper text so the name stays on the land
      const tilt = elong > 4 ? 1.15 : 0.6;
      angle = Math.max(-tilt, Math.min(tilt, angle));
      let lo = Infinity, hi = -Infinity;
      const cs = Math.cos(angle), sn = Math.sin(angle);
      for (const i of main) {
        const geo = PROVINCES[i];
        for (let k = 0; k < geo.polygon.length; k += 2) {
          const proj = (geo.polygon[k] - mx) * cs + (geo.polygon[k + 1] - my) * sn;
          if (proj < lo) lo = proj;
          if (proj > hi) hi = proj;
        }
      }
      const extent = hi - lo;
      const text = c.name.toUpperCase();
      const size = Math.max(5, Math.min(58, (extent * 0.72) / (text.length * 0.78)));
      const t = new Text({
        text,
        style: {
          fontSize: 60,
          fill: 0x0c1218,
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontWeight: 'bold',
          letterSpacing: 4,
          stroke: { color: 0xffffff, width: 1.5 },
        },
      });
      t.anchor.set(0.5);
      t.alpha = 0.78;
      t.rotation = angle;
      t.position.set(mx + (((hi + lo) / 2) * cs), my + (((hi + lo) / 2) * sn));
      t.scale.set(size / 60);
      names.addChild(t);
      labels.push({ t, size });
    }

    // country borders: where the two sides of a shared edge have different owners
    for (const e of edges) {
      if (owners[e.a] === owners[e.b]) continue;
      borderG.moveTo(e.x1, e.y1).lineTo(e.x2, e.y2);
    }
    borderG.stroke({ width: 1, color: 0x0a1016, alpha: 0.85, pixelLine: true });
    for (const l of labels) l.t.visible = l.size * scaleSeen >= 6.5;
  };

  const syncLabels = (scale: number) => {
    scaleSeen = scale;
    for (const l of labels) l.t.visible = l.size * scale >= 6.5;
  };

  return { container, update, syncLabels };
}
