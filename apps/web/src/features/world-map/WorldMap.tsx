import { useEffect, useRef, useState } from 'react';
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, type Texture } from 'pixi.js';
import { createStrategicView, sharedEdges, type StrategicView } from './strategic-view';
import { unitArtUrls } from '../../components/unit-art';
import { TOKEN_BOTTOM, TOKEN_HALF_WIDTH, TOKEN_TOP, drawToken, formationClass } from './army-token';
import { drawResourceIcon, resourceIconsFor } from './resource-icons';
import { BADGE, BADGE_GAP, drawBadge, drawBadgeOverlay, type BadgeSpec } from './building-icons';
import { JUMP, legPolyline, routePolyline, splitAt } from './route-geometry';
import type { Point } from '@cw/shared';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  PROVINCES,
  PROVINCE_BY_KEY,
  ROADS,
  SEA_DOTS,
  roadPath,
  restPoint,
  fleetRange,
  hopsFrom,
  nearestSeaNode,
  seaRange,
  type EnemyFleetDto,
  type FormationDto,
  type ProvinceGeo,
  type SeaMineDto,
  BUILDINGS,
  type StateCountry,
  type StateProvince,
} from '@cw/shared';

export type MapMode = 'political' | 'resources' | 'terrain' | 'supply' | 'diplomacy';

/** Supply overlay: are your armies being fed and fuelled? Other countries are dimmed. */
export const SUPPLY_COLORS: Record<string, number> = {
  'Armies supplied': 0x4caf6f,
  'Armies short of supplies': 0xe5483f,
  'Your provinces, no army': 0x2f5a73,
};

/** Diplomacy overlay: how each country feels about you. */
export const DIPLOMACY_COLORS: Record<string, number> = {
  You: 0xd4a73a,
  Allied: 0x3fbf6f,
  Friendly: 0x8fd8a0,
  Neutral: 0x6b7a8a,
  Unfriendly: 0xe0a040,
  Hostile: 0xe06a3a,
  'At war': 0xe5483f,
};

export const TERRAIN_COLORS: Record<string, number> = {
  plains: 0x93b565,
  forest: 0x3f7a4a,
  hills: 0xb0955a,
  mountains: 0x8a8a96,
  desert: 0xd8c27a,
};

/** Colour used for the strategic resource a province is best at, with a legend in the game page. */
export const RESOURCE_COLORS: Record<string, number> = {
  oil: 0x8b5a2b,
  steel: 0x7a8ea3,
  electronics: 0x3ddc84,
  rare: 0xff8a1f,
  wood: 0xb5783a,
  food: 0x9acd32,
  money: 0xf0c040,
  manpower: 0xd9534f,
};

const RESOURCE_WEIGHT: Record<string, number> = { oil: 3, steel: 2.5, electronics: 8, rare: 10, wood: 2, food: 0.8, money: 1, manpower: 0.5 };

export function dominantResource(key: string): string {
  const prod = PROVINCE_BY_KEY[key].production as unknown as Record<string, number>;
  let best = 'money';
  let bestScore = -1;
  for (const [k, w] of Object.entries(RESOURCE_WEIGHT)) {
    const score = (prod[k] ?? 0) * w;
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}

interface Props {
  provinces: StateProvince[];
  countries: StateCountry[];
  myCountryId: string;
  mode: MapMode;
  /** Countries you are at war with: their provinces get a red outline. */
  atWarWith: string[];
  selectedKey: string | null;
  onSelect: (key: string | null, point?: { x: number; y: number }) => void;
  /** Your armies. Those with a movement are drawn as markers travelling along their route. */
  formations: FormationDto[];
  /** Server time minus browser time, so markers follow the server clock. */
  clockOffsetMs: number;
  /** Route being previewed while giving a move order. */
  previewPath: string[] | null;
  /** The exact spot the army was told to go to inside the last province of the route. */
  previewPoint?: { x: number; y: number } | null;
  /** The previewed order attacks or declares war: the arrow is drawn red. */
  previewHostile?: boolean;
  /** Front-line planning: the country whose border is highlighted in green. */
  frontTarget?: string | null;
  /** Front-line planning: a click chooses a country by its border province; hover highlights it. */
  onFrontHover?: (countryId: string | null) => void;
  /** The previewed route is a sea route (ships follow the dots). */
  previewNaval?: boolean;
  /** Circle of an air patrol being planned. */
  previewPatrol?: { key: string; radius: number } | null;
  /** Diplomacy overlay: relation stage of each country towards you (allied, friendly, neutral, ...). */
  relationByCountry?: Record<string, string>;
  /** Supply overlay: true when some resource your armies need has run out. */
  supplyShort?: boolean;
  /** The army selected for orders, drawn with a gold frame. */
  selectedArmyId?: string | null;
  /** An army figure on the map was clicked. */
  onArmyClick?: (id: string) => void;
  /** Right-click on a province: order the selected army there. */
  onOrder?: (key: string, point?: { x: number; y: number }) => void;
  /** Enemy fleets you can see and mine fields you know of. */
  enemies?: EnemyFleetDto[];
  mines?: SeaMineDto[];
  /** An enemy fleet was clicked / right-clicked (right-click orders an attack). */
  onEnemyClick?: (id: string) => void;
  onEnemyOrder?: (id: string) => void;
  /** Right-click on open sea: sail the selected fleet to the nearest dot. */
  onSeaOrder?: (node: number) => void;
  /** Open-sea route being planned (dots), drawn as a white line. */
  previewSea?: number[] | null;
  selectedEnemyId?: string | null;
}

interface Shape {
  g: Graphics;
  /** Capital star and army count. Created only for provinces that have something to say. */
  label: Text | null;
  /** The province name, created the first time it is zoomed in on. */
  nameLabel: Text | null;
  /** What the polygon was last drawn with, so unchanged provinces are not redrawn. */
  sig: string;
  labelText: string;
  /** Small resource icons (oil, steel, ...). Doubled deposits get a gold ring and x2. */
  icons: Container | null;
  /** True for the player's own provinces: only those show resource icons and building badges. Foreign ones show just a capital. */
  detail: boolean;
}

/** The row of building badges standing on one province. */
interface BuildingRow {
  box: Container;
  sig: string;
  items: { overlay: Graphics; spec: BadgeSpec; startedAt: number; completesAt: number }[];
}

interface Ctx {
  app: Application;
  world: Container;
  shapes: Map<string, Shape>;
  bRows: Map<string, BuildingRow>;
  makeLabel: (geo: ProvinceGeo, shape: Shape) => Text;
  strategic: StrategicView;
  frontG: Graphics;
  /** Forces the next frame to re-run the zoom and visibility pass. */
  invalidate: () => void;
  dispose: () => void;
}

/** Unit artwork loaded from public/units, shared by every token. null = not available, use the drawn figure. */
const unitTextures = new Map<string, Texture | null>();
const unitTextureLoading = new Set<string>();
function requestUnitTexture(unitType: string) {
  if (unitTextures.has(unitType) || unitTextureLoading.has(unitType)) return;
  unitTextureLoading.add(unitType);
  void (async () => {
    for (const url of unitArtUrls(unitType as Parameters<typeof unitArtUrls>[0])) {
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) continue;
        unitTextures.set(unitType, (await Assets.load(url)) as Texture);
        return;
      } catch {
        /* try the next candidate */
      }
    }
    unitTextures.set(unitType, null);
  })();
}

/** The unit type with the most men in a formation: its artwork stands for the whole army. */
function leadUnit(units: { unitType: string; count: number }[]): string | null {
  let best: string | null = null;
  let n = -1;
  for (const u of units) if (u.count > n) { n = u.count; best = u.unitType; }
  return best;
}

const hex = (c: string) => parseInt(c.replace('#', ''), 16);
/** Below this zoom the map shows whole countries; at or above it, provinces. */
const STRATEGIC_BELOW = 0.9;
const centerOf = (key: string) => PROVINCE_BY_KEY[key].center;


const stageLabel = (stage?: string) => (stage === 'war' ? 'At war' : stage ? stage[0].toUpperCase() + stage.slice(1) : 'Neutral');

/** Small terrain marks on a province so the map reads as a map and not a colour chart. */
function drawTerrainMarks(g: Graphics, polygon: number[], terrain: string, seed: number) {
  const xs = polygon.filter((_, i) => i % 2 === 0);
  const ys = polygon.filter((_, i) => i % 2 === 1);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const inside = (px: number, py: number) => {
    let c = false;
    for (let i = 0, j = polygon.length / 2 - 1; i < polygon.length / 2; j = i++) {
      const xi = polygon[i * 2], yi = polygon[i * 2 + 1], xj = polygon[j * 2], yj = polygon[j * 2 + 1];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  let r = seed || 1;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const count = Math.min(9, Math.max(3, Math.round(((maxX - minX) * (maxY - minY)) / 900)));
  for (let n = 0, tries = 0; n < count && tries < 60; tries++) {
    const px = minX + rnd() * (maxX - minX);
    const py = minY + rnd() * (maxY - minY);
    if (!inside(px, py) || !inside(px + 4, py) || !inside(px - 4, py) || !inside(px, py + 4)) continue;
    n++;
    switch (terrain) {
      case 'mountains':
        g.poly([px - 4, py + 3, px, py - 4, px + 4, py + 3]).fill({ color: 0x000000, alpha: 0.28 });
        g.poly([px - 1, py - 1.4, px, py - 4, px + 1, py - 1.4]).fill({ color: 0xffffff, alpha: 0.5 });
        break;
      case 'forest':
        g.circle(px, py, 2.6).fill({ color: 0x0b2412, alpha: 0.4 });
        g.rect(px - 0.4, py + 2, 0.8, 1.8).fill({ color: 0x0b2412, alpha: 0.4 });
        break;
      case 'hills':
        g.moveTo(px - 3.4, py + 2).arc(px, py + 2, 3.4, Math.PI, 0).stroke({ width: 1.1, color: 0x000000, alpha: 0.3 });
        break;
      case 'desert':
        g.circle(px, py, 0.9).fill({ color: 0x7a5a10, alpha: 0.4 });
        g.circle(px + 2.5, py + 1.5, 0.7).fill({ color: 0x7a5a10, alpha: 0.4 });
        break;
      default:
        g.moveTo(px - 3, py).lineTo(px + 3, py).stroke({ width: 0.8, color: 0x1d3a10, alpha: 0.25 });
    }
  }
}

/** Interactive PixiJS map. Geometry comes from shared map data; ownership comes from the server. */
export function WorldMap({
  provinces,
  countries,
  myCountryId,
  mode,
  atWarWith,
  selectedKey,
  onSelect,
  formations,
  clockOffsetMs,
  previewPath,
  previewNaval,
  previewPatrol,
  relationByCountry,
  supplyShort,
  selectedArmyId,
  onArmyClick,
  onOrder,
  enemies,
  mines,
  onEnemyClick,
  onEnemyOrder,
  onSeaOrder,
  previewSea,
  selectedEnemyId,
  previewPoint,
  previewHostile,
  frontTarget,
  onFrontHover,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const dragMoved = useRef(false);
  const onSelectRef = useRef(onSelect);
  const formationsRef = useRef(formations);
  const offsetRef = useRef(clockOffsetMs);
  const previewRef = useRef(previewPath);
  const previewNavalRef = useRef(previewNaval);
  const previewPatrolRef = useRef(previewPatrol);
  const previewPointRef = useRef(previewPoint);
  const previewHostileRef = useRef(previewHostile);
  const onFrontHoverRef = useRef(onFrontHover);
  const frontTargetRef = useRef(frontTarget);
  previewPatrolRef.current = previewPatrol;
  const railSig = [...new Set(provinces.filter((p) => p.buildings.some((b) => b.type === 'railway' && b.status === 'complete' && b.damage < 50)).map((p) => p.key))].sort().join(',');
  const railRef = useRef(railSig);
  railRef.current = railSig;
  const selectedArmyRef = useRef(selectedArmyId);
  const onArmyClickRef = useRef(onArmyClick);
  const onOrderRef = useRef(onOrder);
  selectedArmyRef.current = selectedArmyId;
  onArmyClickRef.current = onArmyClick;
  onOrderRef.current = onOrder;
  const enemiesRef = useRef(enemies);
  const minesRef = useRef(mines);
  const onEnemyClickRef = useRef(onEnemyClick);
  const onEnemyOrderRef = useRef(onEnemyOrder);
  const onSeaOrderRef = useRef(onSeaOrder);
  const previewSeaRef = useRef(previewSea);
  const selectedEnemyRef = useRef(selectedEnemyId);
  enemiesRef.current = enemies;
  minesRef.current = mines;
  onEnemyClickRef.current = onEnemyClick;
  onEnemyOrderRef.current = onEnemyOrder;
  onSeaOrderRef.current = onSeaOrder;
  previewSeaRef.current = previewSea;
  selectedEnemyRef.current = selectedEnemyId;
  const hoverRef = useRef<string | null>(null);
  const ownerOfRef = useRef(new Map<string, string>());
  ownerOfRef.current = new Map(provinces.map((p) => [p.key, p.ownerCountryId]));
  const colorsRef = useRef(new Map<string, number>());
  colorsRef.current = new Map(countries.map((c) => [c.id, parseInt(c.color.replace('#', ''), 16)]));
  onSelectRef.current = onSelect;
  formationsRef.current = formations;
  offsetRef.current = clockOffsetMs;
  previewRef.current = previewPath;
  previewNavalRef.current = previewNaval;
  previewPointRef.current = previewPoint;
  previewHostileRef.current = previewHostile;
  onFrontHoverRef.current = onFrontHover;
  frontTargetRef.current = frontTarget;
  const [ready, setReady] = useState(false);

  // Create the Pixi application once.
  useEffect(() => {
    const host = hostRef.current!;
    let disposed = false;
    const app = new Application();

    app
      .init({
        resizeTo: host,
        background: 0x0b1d2e,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      })
      .then(() => {
        if (disposed) {
          app.destroy(true, { children: true });
          return;
        }
        host.appendChild(app.canvas);

        const world = new Container();
        app.stage.addChild(world);
        const fit = () => {
          const s = Math.min(app.screen.width / MAP_WIDTH, app.screen.height / MAP_HEIGHT) * 0.96;
          world.scale.set(s);
          world.position.set((app.screen.width - MAP_WIDTH * s) / 2, (app.screen.height - MAP_HEIGHT * s) / 2);
        };
        fit();

        // Click on empty sea clears the selection.
        app.stage.eventMode = 'static';
        app.stage.hitArea = app.screen;
        app.stage.on('pointertap', (e) => {
          if (e.target === app.stage && !dragMoved.current) onSelectRef.current(null);
        });

        app.stage.on('rightclick', (e) => {
          if (e.target !== app.stage) return;
          const local = world.toLocal(e.global);
          const node = nearestSeaNode(local.x, local.y, 70);
          if (node !== null) onSeaOrderRef.current?.(node);
        });

        const shapes = new Map<string, Shape>();
        for (const geo of PROVINCES) {
          const g = new Graphics();
          g.eventMode = 'static';
          g.cursor = 'pointer';
          g.on('pointertap', (e) => {
            if (dragMoved.current) return;
            const at = world.toLocal(e.global);
            onSelectRef.current(geo.key, { x: at.x, y: at.y });
          });
          g.on('pointerover', () => {
            if (frontTargetRef.current !== undefined && onFrontHoverRef.current) onFrontHoverRef.current(ownerOfRef.current.get(geo.key) ?? null);
          });
          g.on('rightclick', (e) => {
            const at = world.toLocal(e.global);
            onOrderRef.current?.(geo.key, { x: at.x, y: at.y });
          });
          world.addChild(g);
          shapes.set(geo.key, { g, label: null, nameLabel: null, icons: null, sig: '', labelText: '', detail: false });
        }
        // Zoomed-out view: whole countries, borders and names. Shown instead of the provinces below STRATEGIC_BELOW.
        const strategic = createStrategicView({
          isDragging: () => dragMoved.current,
          onSelect: (key) => onSelectRef.current(key),
        });
        world.addChildAt(strategic.container, 0);

        // Depth: a dark copy of the land, offset down and right, sits under it so the land looks raised. Drawn once.
        const slab = new Graphics();
        slab.eventMode = 'none';
        for (const geo of PROVINCES) slab.poly(geo.polygon).fill({ color: 0x02070c, alpha: 0.5 });
        slab.position.set(4, 6);
        world.addChildAt(slab, 0);

        // Roads: land forces travel only along these. They run through the border crossing of the two provinces,
        // never across open water. Highways run out of capitals; ferries follow the sea dots. Kept faint so they
        // do not fight with the map.
        const roadsG = new Graphics();
        roadsG.eventMode = 'none';
        world.addChild(roadsG);
        for (const kind of ['road', 'highway', 'ferry'] as const) {
          for (const r of ROADS) {
            if (r.kind !== kind) continue;
            const pts = roadPath(r.a, r.b);
            if (kind === 'ferry') {
              for (let i = 0; i + 1 < pts.length; i++) {
                const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
                const len = Math.hypot(bx - ax, by - ay) || 1;
                if (len > JUMP) continue;
                for (let d = 0; d < len; d += 12) {
                  const e = Math.min(len, d + 5);
                  roadsG.moveTo(ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len);
                  roadsG.lineTo(ax + ((bx - ax) * e) / len, ay + ((by - ay) * e) / len);
                }
              }
            } else {
              roadsG.moveTo(pts[0][0], pts[0][1]);
              for (const [x, y] of pts.slice(1)) roadsG.lineTo(x, y);
            }
          }
          if (kind === 'road') roadsG.stroke({ width: 0.5, color: 0xf1ead2, alpha: 0.16 });
          else if (kind === 'highway') roadsG.stroke({ width: 0.7, color: 0xffe9a0, alpha: 0.24 });
          else roadsG.stroke({ width: 0.6, color: 0x9fd0ff, alpha: 0.4 });
        }
        for (const geo of PROVINCES) roadsG.circle(geo.center.x, geo.center.y, 1).fill({ color: 0xf1ead2, alpha: 0.25 });

        // Railways: a grey track (bed, ties and two rails), drawn only inside the province that has the railway: from its
        // centre to the border crossing. A road between two railway provinces gets the whole line.
        const railG = new Graphics();
        railG.eventMode = 'none';
        world.addChild(railG);
        let railDrawn = '';
        // the part of a road that lies inside one province: from that province's centre to the border crossing. The road
        // data puts one crossing point on the shared border, so the track stops exactly on the boundary.
        const insidePath = (pts: [number, number][], fromStart: boolean): [number, number][] => {
          const m = pts.length;
          if (m === 2) {
            const mid: [number, number] = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
            return fromStart ? [pts[0], mid] : [pts[1], mid];
          }
          if (m % 2 === 1) {
            const k = (m - 1) / 2;
            return fromStart ? pts.slice(0, k + 1) : pts.slice(k).reverse();
          }
          const h = m / 2;
          const mid: [number, number] = [(pts[h - 1][0] + pts[h][0]) / 2, (pts[h - 1][1] + pts[h][1]) / 2];
          return fromStart ? [...pts.slice(0, h), mid] : [mid, ...pts.slice(h)].reverse();
        };
        const drawRails = () => {
          if (railDrawn === railRef.current) return;
          railDrawn = railRef.current;
          railG.clear();
          const have = new Set(railRef.current ? railRef.current.split(',') : []);
          const lines: [number, number][][] = [];
          for (const r of ROADS) {
            if (r.kind === 'ferry') continue;
            const hasA = have.has(r.a), hasB = have.has(r.b);
            if (!hasA && !hasB) continue;
            const full = roadPath(r.a, r.b);
            if (hasA && hasB) lines.push(full);
            else lines.push(insidePath(full, hasA));
          }
          // grey track: a soft bed, ties across it, and two light rails; about half the size of the first version
          for (const pts of lines) { railG.moveTo(pts[0][0], pts[0][1]); for (const [x, y] of pts.slice(1)) railG.lineTo(x, y); }
          railG.stroke({ width: 2.1, color: 0x3f4246, alpha: 0.55 });
          for (const pts of lines) {
            for (let i = 0; i + 1 < pts.length; i++) {
              const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
              const len = Math.hypot(bx - ax, by - ay) || 1;
              const nx = -(by - ay) / len, ny = (bx - ax) / len;
              for (let d = 1.5; d < len; d += 3) {
                const cx = ax + ((bx - ax) * d) / len, cy = ay + ((by - ay) * d) / len;
                railG.moveTo(cx - nx * 1.6, cy - ny * 1.6).lineTo(cx + nx * 1.6, cy + ny * 1.6);
              }
            }
          }
          railG.stroke({ width: 0.45, color: 0x7b7f84, alpha: 0.9 });
          for (const side of [-0.7, 0.7]) {
            for (const pts of lines) {
              for (let i = 0; i + 1 < pts.length; i++) {
                const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
                const len = Math.hypot(bx - ax, by - ay) || 1;
                const nx = (-(by - ay) / len) * side, ny = ((bx - ax) / len) * side;
                railG.moveTo(ax + nx, ay + ny).lineTo(bx + nx, by + ny);
              }
            }
            railG.stroke({ width: 0.4, color: 0xb4b8bc, alpha: 1 });
          }
        };
        app.ticker.add(drawRails);

        // Sea dots: the lanes ships sail on. Only shown while a ship is selected or a sea route is being planned.
        const seaG = new Graphics();
        seaG.eventMode = 'none';
        seaG.visible = false;
        for (const [x, y] of SEA_DOTS) seaG.circle(x, y, 1.9);
        seaG.fill({ color: 0xcfe8ff, alpha: 0.5 });
        world.addChild(seaG);
        app.ticker.add(() => {
          const sel = formationsRef.current.find((f) => f.id === selectedArmyRef.current);
          seaG.visible = (!!sel && formationClass(sel.units) === 'naval') || !!previewNavalRef.current;
        });

        // Labels are added after all shapes so neighbours never paint over them. With over two thousand provinces they are
        // created only when they are needed: the army count of a province with an army, and names of provinces in view.
        const labelLayer = new Container();
        labelLayer.eventMode = 'none';
        world.addChild(labelLayer);
        const makeLabel = (geo: ProvinceGeo, shape: Shape): Text => {
          const label = new Text({
            text: shape.labelText,
            style: { fontSize: 13, fill: 0xffffff, fontFamily: 'sans-serif', stroke: { color: 0x000000, width: 3 } },
          });
          label.anchor.set(0.5);
          label.position.set(geo.center.x, geo.center.y);
          label.eventMode = 'none';
          label.scale.set(0.9 / world.scale.x);
          label.visible = world.scale.x >= 0.7;
          labelLayer.addChild(label);
          shape.label = label;
          return label;
        };
        const makeName = (geo: ProvinceGeo, shape: Shape): Text => {
          const nameLabel = new Text({
            text: geo.name,
            style: { fontSize: 11, fill: 0xe8eef5, fontFamily: 'sans-serif', stroke: { color: 0x000000, width: 3 } },
          });
          nameLabel.anchor.set(0.5, 0);
          nameLabel.position.set(geo.center.x, geo.center.y + 8);
          nameLabel.eventMode = 'none';
          labelLayer.addChild(nameLabel);
          shape.nameLabel = nameLabel;
          return nameLabel;
        };

        // Resource icons: the resource of every city and every deposit province (deposits are ringed and marked x2).
        for (const geo of PROVINCES) {
          const kinds = resourceIconsFor(geo);
          if (kinds.length === 0) continue;
          const row = new Container();
          row.eventMode = 'none';
          const step = 17;
          const width = kinds.length * step;
          const backing = new Graphics();
          backing.roundRect(-width / 2 - 1, -10, width + 2, 20, 7).fill({ color: 0x000000, alpha: 0.5 });
          row.addChild(backing);
          kinds.forEach((k, i) => {
            const x = -width / 2 + step / 2 + i * step;
            const ic = new Graphics();
            drawResourceIcon(ic, k.kind, x, k.doubled);
            row.addChild(ic);
            if (k.doubled) {
              const t = new Text({
                text: '×2',
                style: { fontSize: 9, fill: 0xffe27a, fontFamily: 'sans-serif', fontWeight: 'bold', stroke: { color: 0x000000, width: 2 } },
              });
              t.anchor.set(0, 0.5);
              t.position.set(x + 4, 6);
              row.addChild(t);
            }
          });
          row.visible = false;
          world.addChild(row);
          shapes.get(geo.key)!.icons = row;
        }

        // Buildings: a badge for each one, standing on its province. Click opens the province; the progress bar of
        // a building under construction fills in real time.
        const bRows = new Map<string, BuildingRow>();
        const bLayer = new Container();
        world.addChild(bLayer);
        for (const geo of PROVINCES) {
          const box = new Container();
          box.eventMode = 'static';
          box.cursor = 'pointer';
          box.visible = false;
          box.on('pointertap', (e) => {
            e.stopPropagation();
            if (!dragMoved.current) onSelectRef.current(geo.key);
          });
          box.on('rightclick', () => onOrderRef.current?.(geo.key));
          bLayer.addChild(box);
          bRows.set(geo.key, { box, sig: '', items: [] });
        }
        // Tooltip for building badges (screen space, above everything).
        const tip = new Container();
        tip.visible = false;
        tip.eventMode = 'none';
        const tipBg = new Graphics();
        const tipText = new Text({ text: '', style: { fontSize: 12, fill: 0xffffff, fontFamily: 'sans-serif', lineHeight: 15 } });
        tipText.position.set(7, 4);
        tip.addChild(tipBg, tipText);
        app.stage.addChild(tip);
        for (const [key, row] of bRows) {
          row.box.on('pointermove', (e) => {
            const local = row.box.toLocal(e.global);
            const n = row.items.length;
            if (n === 0) return;
            const total = n * BADGE + (n - 1) * BADGE_GAP;
            const i = Math.min(n - 1, Math.max(0, Math.floor((local.x + total / 2) / (BADGE + BADGE_GAP))));
            const it = row.items[i];
            const def = BUILDINGS[it.spec.type];
            const lines = [def.name];
            if (it.spec.constructing) lines.push(`Under construction: ${Math.round(Math.min(1, Math.max(0, it.spec.progress)) * 100)}%`);
            else if (it.spec.damage >= 50) lines.push(`Knocked out by bombing (${Math.round(it.spec.damage)}% damage). Repairs 1% per game hour.`);
            else if (it.spec.damage > 0) lines.push(`Bomb damage ${Math.round(it.spec.damage)}% (stops working at 50%)`);
            else lines.push(def.description.length > 90 ? def.description.slice(0, 88) + '…' : def.description);
            lines.push(PROVINCE_BY_KEY[key]?.name ?? '');
            tipText.text = lines.join('\n');
            tipBg.clear();
            tipBg.roundRect(0, 0, tipText.width + 14, tipText.height + 8, 4).fill({ color: 0x101b27, alpha: 0.95 }).stroke({ width: 1, color: 0x35506a });
            tip.position.set(Math.min(e.global.x + 14, app.screen.width - tipText.width - 24), e.global.y + 14);
            tip.visible = true;
          });
          row.box.on('pointerout', () => {
            tip.visible = false;
          });
        }
        let lastProgress = 0;
        app.ticker.add(() => {
          const t = Date.now();
          if (t - lastProgress < 1000) return;
          lastProgress = t;
          const now = t + offsetRef.current;
          for (const row of bRows.values()) {
            for (const it of row.items) {
              if (!it.spec.constructing) continue;
              const span = it.completesAt - it.startedAt;
              it.spec.progress = span > 0 ? (now - it.startedAt) / span : 1;
              drawBadgeOverlay(it.overlay, it.spec);
            }
          }
        });

        // Keep labels a readable size at every zoom, and only show detail when zoomed in, and only for what is on screen.
        let lastScale = -1, viewX = NaN, viewY = NaN, stratOn = false;
        // Province bounding boxes, so shapes off screen are not drawn at all (the GPU would otherwise paint all 2,300).
        const bounds = new Map<string, [number, number, number, number]>();
        for (const geo of PROVINCES) {
          let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
          for (let i = 0; i < geo.polygon.length; i += 2) {
            const x = geo.polygon[i], y = geo.polygon[i + 1];
            if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y;
          }
          bounds.set(geo.key, [a, b, c, d]);
        }
        const syncLabels = () => {
          const sc = world.scale.x;
          const px = world.position.x, py = world.position.y;
          if (sc === lastScale && px === viewX && py === viewY) return;
          lastScale = sc; viewX = px; viewY = py;
          // Strategic view below the threshold (with a little hysteresis so it does not flicker at the edge).
          const strat = sc < (stratOn ? STRATEGIC_BELOW + 0.08 : STRATEGIC_BELOW);
          if (strat !== stratOn) {
            stratOn = strat;
            strategic.container.visible = strat;
            for (const s of shapes.values()) {
              if (strat) s.g.visible = false;
              if (strat) {
                if (s.icons) s.icons.visible = false;
                if (s.label) s.label.visible = false;
                if (s.nameLabel) s.nameLabel.visible = false;
              }
            }
            for (const row of bRows.values()) if (strat) row.box.visible = false;
            roadsG.visible = !strat;
            railG.visible = !strat;
          }
          if (strat) { strategic.syncLabels(sc); return; }
          const x0 = -px / sc - 60, x1 = (app.screen.width - px) / sc + 60;
          const y0 = -py / sc - 60, y1 = (app.screen.height - py) / sc + 60;
          for (const geo of PROVINCES) {
            const shape = shapes.get(geo.key)!;
            const cx = geo.center.x, cy = geo.center.y;
            const inView = cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
            const bb = bounds.get(geo.key)!;
            shape.g.visible = bb[2] >= x0 && bb[0] <= x1 && bb[3] >= y0 && bb[1] <= y1;
            const icons = shape.icons;
            if (icons) {
              icons.visible = shape.detail && sc >= 0.9 && inView;
              if (icons.visible) { icons.scale.set(0.9 / sc); icons.position.set(cx, cy - 15 / sc); }
            }
            const row = bRows.get(geo.key)!;
            row.box.visible = shape.detail && sc >= 0.9 && inView && row.items.length > 0;
            if (row.box.visible) { row.box.scale.set(0.9 / sc); row.box.position.set(cx, cy - 38 / sc); }
            if (shape.label) {
              shape.label.visible = sc >= 0.7 && inView;
              shape.label.scale.set(0.9 / sc);
            }
            // Only cities carry a name on the map; plains, hills and the rest are named in their panel.
            if (sc >= 1.5 && inView && (geo.isCapital || (shape.detail && geo.isCity))) {
              const nl = shape.nameLabel ?? makeName(geo, shape);
              nl.visible = true;
              nl.scale.set(0.85 / sc);
              nl.position.y = cy + 7 / sc;
            } else if (shape.nameLabel) shape.nameLabel.visible = false;
          }
        };
        app.ticker.add(syncLabels);

        // Army layer: route preview, travelling markers. Redrawn every frame from server times.
        const frontG = new Graphics();
        frontG.eventMode = 'none';
        world.addChild(frontG);
        const armyLayer = new Container();
        armyLayer.eventMode = 'passive';
        world.addChild(armyLayer);
        const seaFxG = new Graphics();
        seaFxG.eventMode = 'none';
        armyLayer.addChild(seaFxG);
        const enemyTokens = new Map<string, { box: Container; g: Graphics; label: Text }>();
        const routeG = new Graphics();
        armyLayer.addChild(routeG);
        routeG.eventMode = 'none';
        const tokens = new Map<string, { box: Container; g: Graphics; art: Sprite; label: Text; sig: string }>();

        // A patrol circle: soft fill and a slowly turning dashed ring.
        const patrolRing = (cx: number, cy: number, r: number, t: number, color: number, strong: boolean) => {
          routeG.circle(cx, cy, r).fill({ color, alpha: strong ? 0.12 : 0.07 });
          const n = 40;
          const spin = t * 0.00025;
          for (let i = 0; i < n; i++) {
            const a0 = spin + (i / n) * Math.PI * 2;
            const a1 = a0 + (Math.PI * 2) / n * 0.55;
            routeG.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r).arc(cx, cy, r, a0, a1);
          }
          routeG.stroke({ width: strong ? 2.4 : 1.6, color, alpha: strong ? 0.95 : 0.6 });
        };

        const drawArmies = () => {
          const now = Date.now() + offsetRef.current;
          routeG.clear();

          // Air patrols: every one of your own, and the one being planned.
          for (const f of formationsRef.current) {
            if (!f.patrol) continue;
            const c = PROVINCE_BY_KEY[f.patrol.provinceKey];
            if (c) patrolRing(c.center.x, c.center.y, f.patrol.radius, now, 0xfff0a8, selectedArmyRef.current === f.id);
          }
          const pp = previewPatrolRef.current;
          if (pp) {
            const c = PROVINCE_BY_KEY[pp.key];
            if (c) patrolRing(c.center.x, c.center.y, pp.radius, now, 0xffffff, true);
          }

          const preview = previewRef.current;
          if (preview && preview.length > 0) {
            const line = routePolyline(preview, !!previewNavalRef.current);
            routeG.moveTo(line[0][0], line[0][1]);
            for (const [x, y] of line.slice(1)) routeG.lineTo(x, y);
            const hostile = !!previewHostileRef.current;
            const col = hostile ? 0xff4d3d : 0xffffff;
            const pt = previewPointRef.current;
            let tip = line[line.length - 1];
            if (pt) {
              const lastKey = preview[preview.length - 1];
              const inside = restPoint(lastKey, pt.x, pt.y);
              if (inside) { routeG.lineTo(pt.x, pt.y); tip = [pt.x, pt.y]; }
            }
            routeG.stroke({ width: 3, color: col, alpha: 0.95 });
            const before = line.length > 1 ? line[line.length - 2] : tip;
            const ang = Math.atan2(tip[1] - before[1], tip[0] - before[0]);
            const ah = 14;
            routeG
              .poly([tip[0], tip[1], tip[0] - Math.cos(ang - 0.45) * ah, tip[1] - Math.sin(ang - 0.45) * ah, tip[0] - Math.cos(ang + 0.45) * ah, tip[1] - Math.sin(ang + 0.45) * ah])
              .fill({ color: col })
              .stroke({ width: 1, color: 0x101b27 });
          }

          // ---- naval extras: range of the selected fleet, mines, enemy fleets, planned sea route
          seaFxG.clear();
          const selFleet = formationsRef.current.find((f) => f.id === selectedArmyRef.current);
          if (selFleet?.sea) {
            const here = selFleet.sea.voyage
              ? (() => {
                  const v = selFleet.sea!.voyage!;
                  const st = Date.parse(v.startedAt);
                  const en = Date.parse(v.arrivesAt);
                  const t = en > st ? Math.min(1, Math.max(0, (now - st) / (en - st))) : 1;
                  return v.nodes[Math.min(v.nodes.length - 1, Math.floor(t * (v.nodes.length - 1)))];
                })()
              : selFleet.sea.node;
            const maxR = Math.max(0, ...selFleet.units.map((u) => seaRange(u.unitType)));
            const shortR = fleetRange(selFleet.units);
            for (const [n, d] of hopsFrom([here], maxR)) {
              if (n === here) continue;
              seaFxG.circle(SEA_DOTS[n][0], SEA_DOTS[n][1], d <= shortR ? 3.6 : 3).fill({ color: d <= shortR ? 0xffe27a : 0x9fd0ff, alpha: 0.75 });
            }
          }
          const planned = previewSeaRef.current;
          if (planned && planned.length > 1) {
            seaFxG.moveTo(SEA_DOTS[planned[0]][0], SEA_DOTS[planned[0]][1]);
            for (const n of planned.slice(1)) seaFxG.lineTo(SEA_DOTS[n][0], SEA_DOTS[n][1]);
            seaFxG.stroke({ width: 3, color: 0xffffff, alpha: 0.9 });
          }
          for (const m of minesRef.current ?? []) {
            const [mx, my] = SEA_DOTS[m.node];
            const col = m.mine ? 0xffe27a : 0xff6b5b;
            seaFxG.circle(mx, my, 5).fill({ color: 0x101b27, alpha: 0.9 }).stroke({ width: 1.5, color: col });
            for (let a = 0; a < 8; a++) {
              const ang = (a * Math.PI) / 4;
              seaFxG.moveTo(mx + Math.cos(ang) * 5, my + Math.sin(ang) * 5).lineTo(mx + Math.cos(ang) * 8, my + Math.sin(ang) * 8);
            }
            seaFxG.stroke({ width: 1.3, color: col });
          }
          const seenEnemy = new Set<string>();
          const kk = Math.min(1.4, 0.9 / world.scale.x);
          for (const e of enemiesRef.current ?? []) {
            let et = enemyTokens.get(e.id);
            if (!et) {
              const box = new Container();
              box.eventMode = 'static';
              box.cursor = 'crosshair';
              box.hitArea = new Rectangle(-16, -16, 32, 32);
              const id = e.id;
              box.on('pointertap', (ev) => {
                ev.stopPropagation();
                if (!dragMoved.current) onEnemyClickRef.current?.(id);
              });
              box.on('rightclick', (ev) => {
                ev.stopPropagation();
                onEnemyOrderRef.current?.(id);
              });
              const g = new Graphics();
              const label = new Text({ text: '', style: { fontSize: 13, fill: 0xffffff, fontFamily: 'sans-serif', fontWeight: 'bold' } });
              label.anchor.set(0.5);
              box.addChild(g);
              box.addChild(label);
              armyLayer.addChild(box);
              et = { box, g, label };
              enemyTokens.set(e.id, et);
            }
            const sel = selectedEnemyRef.current === e.id;
            et.g.clear();
            et.g.circle(0, 0, 14).fill({ color: 0xb3261e, alpha: 0.92 }).stroke({ width: sel ? 3.5 : 2, color: sel ? 0xffe27a : 0xffffff });
            et.label.text = e.submarines && e.ships === 0 ? '?' : String(e.ships);
            const [ex, ey] = SEA_DOTS[e.node];
            et.box.position.set(ex, ey);
            et.box.scale.set(kk);
            seenEnemy.add(e.id);
            if (e.toNode !== null) {
              seaFxG.moveTo(ex, ey).lineTo(SEA_DOTS[e.toNode][0], SEA_DOTS[e.toNode][1]).stroke({ width: 1.5, color: 0xff6b5b, alpha: 0.6 });
            }
          }
          for (const [id, et] of enemyTokens) {
            if (!seenEnemy.has(id)) {
              armyLayer.removeChild(et.box);
              et.box.destroy({ children: true });
              enemyTokens.delete(id);
            }
          }

          const seen = new Set<string>();
          const sc = world.scale.x;
          const k = Math.min(1.4, 0.9 / sc); // counters keep a readable size at every zoom
          const colors = colorsRef.current;
          const slots = new Map<string, number>();
          for (const f of formationsRef.current) {
            const m = f.movement;
            let x: number;
            let y: number;
            if (f.sea) {
              const v = f.sea.voyage;
              if (v) {
                const pts: Point[] = v.nodes.map((n) => SEA_DOTS[n]);
                if (v.destKey) pts.push([centerOf(v.destKey).x, centerOf(v.destKey).y]);
                const st = Date.parse(v.startedAt);
                const en = Date.parse(v.arrivesAt);
                const t = en > st ? Math.min(1, Math.max(0, (now - st) / (en - st))) : 1;
                const { at, rest } = splitAt(pts, t);
                x = at[0];
                y = at[1];
                if (rest.length > 1) {
                  const line = [at, ...rest.slice(1)];
                  for (let i = 0; i < line.length - 1; i++) {
                    const [x0, y0] = line[i];
                    const [x1, y1] = line[i + 1];
                    const len = Math.hypot(x1 - x0, y1 - y0);
                    if (len === 0 || len > JUMP) continue;
                    for (let d = 0; d < len; d += 12 * k) {
                      const e2 = Math.min(len, d + 7 * k);
                      routeG.moveTo(x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len);
                      routeG.lineTo(x0 + ((x1 - x0) * e2) / len, y0 + ((y1 - y0) * e2) / len);
                    }
                  }
                  routeG.stroke({ width: 2 * k, color: v.attackTargetId ? 0xff6b5b : 0xffe27a, alpha: 0.9 });
                }
              } else {
                x = SEA_DOTS[f.sea.node][0];
                y = SEA_DOTS[f.sea.node][1];
              }
            } else if (m) {
              const naval = formationClass(f.units) === 'naval';
              const start = Date.parse(m.startedAt);
              const end = Date.parse(m.arrivesAt);
              const held = !!m.holdUntil && Date.parse(m.holdUntil) > now;
              const t = held ? (m.holdFraction ?? 0) : end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 1;
              const { at, rest } = splitAt(legPolyline(f.provinceKey, m.toKey, naval), t);
              x = at[0];
              y = at[1];
              // Dashed look: the route ahead is drawn as short gold segments with an arrow head at the end.
              const line = [...rest];
              let from = m.toKey;
              for (const key of m.remainingKeys) {
                line.push(...legPolyline(from, key, naval).slice(1));
                from = key;
              }
              const pts = line.map(([px, py]) => ({ x: px, y: py }));
              const lit = selectedArmyRef.current === f.id || hoverRef.current === f.id;
              const walk = (draw: (p0: { x: number; y: number }, p1: { x: number; y: number }, len: number) => void) => {
                for (let i = 0; i < pts.length - 1; i++) {
                  const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
                  if (len === 0 || len > JUMP) continue;
                  draw(pts[i], pts[i + 1], len);
                }
              };
              // Every army's orders: a thin steel-blue line with an arrow at the end. Hover or select an army and the
              // line becomes a wider blue track with white dashes marching towards the destination.
              walk((p0, p1) => routeG.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y));
              routeG.stroke({ width: (lit ? 3.4 : 1.8) * k, color: 0x2f5a73, alpha: lit ? 1 : 0.85 });
              if (lit) {
                const dash = 7 * k;
                const gap = 6 * k;
                const shift = ((performance.now() / 45) * k) % (dash + gap);
                let carried = 0;
                walk((p0, p1, len) => {
                  for (let d = -shift + carried; d < len; d += dash + gap) {
                    const d0 = Math.max(0, d);
                    const e = Math.min(len, d + dash);
                    if (e <= d0) continue;
                    routeG.moveTo(p0.x + ((p1.x - p0.x) * d0) / len, p0.y + ((p1.y - p0.y) * d0) / len);
                    routeG.lineTo(p0.x + ((p1.x - p0.x) * e) / len, p0.y + ((p1.y - p0.y) * e) / len);
                  }
                  carried = (carried + len) % (dash + gap);
                });
                routeG.stroke({ width: 1.8 * k, color: 0xffffff, alpha: 0.95 });
              }
              const last = pts[pts.length - 1];
              const prev = pts[pts.length - 2];
              const ang = Math.atan2(last.y - prev.y, last.x - prev.x);
              const ah = (lit ? 11 : 8) * k;
              routeG
                .poly([
                  last.x, last.y,
                  last.x - Math.cos(ang - 0.45) * ah, last.y - Math.sin(ang - 0.45) * ah,
                  last.x - Math.cos(ang + 0.45) * ah, last.y - Math.sin(ang + 0.45) * ah,
                ])
                .fill({ color: lit ? 0xffffff : 0x2f5a73 })
                .stroke({ width: 1.2 * k, color: 0x2f5a73 });
            } else {
              if (sc < 0.7) continue;
              const c = centerOf(f.provinceKey);
              const i = slots.get(f.provinceKey) ?? 0;
              slots.set(f.provinceKey, i + 1);
              const rp = restPoint(f.provinceKey, f.rest?.x, f.rest?.y);
              if (rp) {
                x = rp.x;
                y = rp.y;
              } else {
                x = c.x + i * 38 * k;
                y = c.y + 42 * k;
              }
            }
            const cls = formationClass(f.units);
            const ownerColor = colors.get(f.countryId) ?? 0x888888;
            const isSelected = selectedArmyRef.current === f.id;
            let tk = tokens.get(f.id);
            if (!tk) {
              const box = new Container();
              box.eventMode = 'static';
              box.cursor = 'pointer';
              box.hitArea = new Rectangle(-TOKEN_HALF_WIDTH, TOKEN_TOP, TOKEN_HALF_WIDTH * 2, TOKEN_BOTTOM - TOKEN_TOP);
              const id = f.id;
              box.on('pointertap', (e) => {
                e.stopPropagation();
                if (!dragMoved.current) onArmyClickRef.current?.(id);
              });
              box.on('pointerover', () => {
                hoverRef.current = id;
              });
              box.on('pointerout', () => {
                if (hoverRef.current === id) hoverRef.current = null;
              });
              const g = new Graphics();
              const art = new Sprite();
              art.anchor.set(0.5, 1);
              art.position.set(0, -9);
              art.visible = false;
              const label = new Text({
                text: '',
                style: { fontSize: 12, fill: 0xffffff, fontFamily: 'sans-serif', fontWeight: 'bold' },
              });
              label.anchor.set(0.5);
              label.position.set(8, 0.5);
              box.addChild(g);
              box.addChild(art);
              box.addChild(label);
              armyLayer.addChild(box);
              tk = { box, g, art, label, sig: '' };
              tokens.set(f.id, tk);
            }
            const lead = leadUnit(f.units);
            if (lead) requestUnitTexture(lead);
            const tex = lead ? (unitTextures.get(lead) ?? null) : null;
            const sig = `${cls}|${ownerColor}|${isSelected}|${tex ? lead : ''}`;
            if (tk.sig !== sig) {
              tk.g.clear();
              drawToken(tk.g, ownerColor, cls, isSelected, !!tex);
              if (tex) {
                tk.art.texture = tex;
                const fit = Math.min(38 / tex.height, 46 / tex.width);
                tk.art.scale.set(fit);
                tk.art.visible = true;
              } else {
                tk.art.visible = false;
              }
              tk.sig = sig;
            }
            tk.box.position.set(x, y);
            tk.box.scale.set(k);
            const total = String(f.units.reduce((s, u) => s + u.count, 0));
            if (tk.label.text !== total) tk.label.text = total;
            seen.add(f.id);
          }
          for (const [id, tk] of tokens) {
            if (!seen.has(id)) {
              armyLayer.removeChild(tk.box);
              tk.box.destroy({ children: true });
              tokens.delete(id);
            }
          }
        };
        app.ticker.add(drawArmies);

        // Pan with drag, zoom with the wheel.
        const canvas = app.canvas as HTMLCanvasElement;
        let dragging = false;
        let lastX = 0;
        let lastY = 0;
        let startX = 0;
        let startY = 0;
        const pointers = new Map<number, { x: number; y: number }>();
        let pinchDist = 0;
        const zoomAt = (cx: number, cy: number, factor: number) => {
          const rect = canvas.getBoundingClientRect();
          const mx = cx - rect.left;
          const my = cy - rect.top;
          const old = world.scale.x;
          const next = Math.min(6, Math.max(0.3, old * factor));
          const k = next / old;
          world.x = mx - (mx - world.x) * k;
          world.y = my - (my - world.y) * k;
          world.scale.set(next);
        };
        const pinchState = () => {
          const [p1, p2] = [...pointers.values()];
          return { d: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        };
        const down = (e: PointerEvent) => {
          if (e.button !== 0) return; // right-click is for orders, not panning
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.size === 2) {
            // Two fingers: pinch to zoom.
            dragging = false;
            dragMoved.current = true;
            pinchDist = pinchState().d;
            return;
          }
          dragging = true;
          dragMoved.current = false;
          lastX = startX = e.clientX;
          lastY = startY = e.clientY;
        };
        const move = (e: PointerEvent) => {
          if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.size === 2) {
            const p = pinchState();
            zoomAt(p.x, p.y, p.d / pinchDist);
            pinchDist = p.d;
            return;
          }
          if (!dragging) return;
          if (Math.hypot(e.clientX - startX, e.clientY - startY) > 4) dragMoved.current = true;
          if (dragMoved.current) {
            world.x += e.clientX - lastX;
            world.y += e.clientY - lastY;
          }
          lastX = e.clientX;
          lastY = e.clientY;
        };
        const up = (e: PointerEvent) => {
          pointers.delete(e.pointerId);
          dragging = false;
        };
        const wheel = (e: WheelEvent) => {
          e.preventDefault();
          zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
        };
        const noMenu = (e: Event) => e.preventDefault();
        canvas.addEventListener('contextmenu', noMenu);
        canvas.addEventListener('pointerdown', down);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        canvas.addEventListener('wheel', wheel, { passive: false });

        // The side drawer opens and closes without a window resize, so watch the map's own box.
        const resizeObserver = new ResizeObserver(() => app.resize());
        resizeObserver.observe(host);

        ctxRef.current = {
          app,
          world,
          shapes,
          bRows,
          makeLabel,
          strategic,
          frontG,
          invalidate: () => { lastScale = -1; },
          dispose: () => {
            resizeObserver.disconnect();
            app.ticker.remove(drawArmies);
            app.ticker.remove(syncLabels);
            canvas.removeEventListener('contextmenu', noMenu);
            canvas.removeEventListener('pointerdown', down);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            canvas.removeEventListener('wheel', wheel);
          },
        };
        setReady(true);
      });

    return () => {
      disposed = true;
      const ctx = ctxRef.current;
      if (ctx) {
        ctx.dispose();
        ctx.app.destroy(true, { children: true });
        ctxRef.current = null;
      }
      setReady(false);
    };
  }, []);

  // Redraw whenever ownership, buildings, units or selection change.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !ready) return;
    const colorById = new Map(countries.map((c) => [c.id, hex(c.color)]));
    const stateByKey = new Map(provinces.map((p) => [p.key, p]));
    const atWarSet = new Set(atWarWith);
    const capitalKeys = new Set(countries.map((c) => c.capitalProvinceKey).filter(Boolean));
    ctx.strategic.update(
      PROVINCES.map((geo) => stateByKey.get(geo.key)?.ownerCountryId ?? ''),
      countries.map((c) => ({ id: c.id, name: c.name, color: hex(c.color), clickKey: c.capitalProvinceKey })),
    );

    for (const geo of PROVINCES) {
      const shape = ctx.shapes.get(geo.key);
      const st = stateByKey.get(geo.key);
      if (!shape || !st) continue;
      const mine = st.ownerCountryId === myCountryId;
      const wasDetail = shape.detail;
      shape.detail = mine || mode === 'resources';
      if (wasDetail !== shape.detail) ctx.invalidate();
      const selected = selectedKey === geo.key;
      const enemy = atWarSet.has(st.ownerCountryId);

      const stage = mode === 'diplomacy' ? stageLabel(relationByCountry?.[st.ownerCountryId]) : '';
      const supplyBits = mode === 'supply' ? `${st.unitCount > 0 ? 1 : 0}${supplyShort ? 1 : 0}` : '';
      const sig = `${mode}|${st.ownerCountryId}|${mine ? 1 : 0}${selected ? 1 : 0}${enemy ? 1 : 0}|${stage}|${supplyBits}`;
      if (shape.sig !== sig) {
      shape.sig = sig;
      shape.g.clear();
      shape.g
        .poly(geo.polygon)
        .fill({
          color:
            mode === 'terrain'
              ? (TERRAIN_COLORS[geo.terrain] ?? 0x555555)
              : mode === 'resources'
                ? (RESOURCE_COLORS[dominantResource(geo.key)] ?? 0x555555)
                : mode === 'supply'
                  ? mine
                    ? st.unitCount > 0
                      ? supplyShort
                        ? SUPPLY_COLORS['Armies short of supplies']
                        : SUPPLY_COLORS['Armies supplied']
                      : SUPPLY_COLORS['Your provinces, no army']
                    : 0x222d38
                  : mode === 'diplomacy'
                    ? mine
                      ? DIPLOMACY_COLORS.You
                      : (DIPLOMACY_COLORS[stageLabel(relationByCountry?.[st.ownerCountryId])] ?? DIPLOMACY_COLORS.Neutral)
                    : (colorById.get(st.ownerCountryId) ?? 0x555555),
          alpha: mode === 'political' ? (mine ? 0.95 : 0.86) : mine ? 0.95 : 0.88,
        })
        // Thin lines: ordinary borders are one screen pixel at any zoom (pixelLine); your own and enemy provinces
        // are only slightly stronger so they still read at a glance.
        .stroke(
          selected
            ? { width: 1.6, color: 0xffffff }
            : mine
              ? { width: 0.5, color: 0xffe27a, alpha: 0.55 }
              : enemy
                ? { width: 0.5, color: 0xe5483f, alpha: 0.6 }
                : { width: 1, color: 0x0b1d2e, alpha: 0.3, pixelLine: true },
        );

      // Building badges.
      const row = ctx.bRows.get(geo.key);
      if (row) {
        const ownerColor = colorById.get(st.ownerCountryId) ?? 0x888888;
        const list = st.buildings.slice(0, 7);
        const sig = `${ownerColor}|${list.map((b) => `${b.type}:${b.status}:${Math.round(b.damage / 5)}:${b.completesAt}`).join(',')}`;
        if (row.sig !== sig) {
          row.sig = sig;
          for (const c of row.box.removeChildren()) c.destroy({ children: true });
          row.items = [];
          const n = list.length;
          const total = n * BADGE + (n - 1) * BADGE_GAP;
          const sc = ctx.world.scale.x;
          list.forEach((b, i) => {
            const spec: BadgeSpec = {
              type: b.type,
              constructing: b.status === 'constructing',
              damage: b.damage,
              progress: 0,
              ownerColor,
            };
            const startedAt = Date.parse(b.startedAt);
            const completesAt = Date.parse(b.completesAt);
            spec.progress = completesAt > startedAt ? (Date.now() + clockOffsetMs - startedAt) / (completesAt - startedAt) : 1;
            const holder = new Container();
            holder.position.set(-total / 2 + BADGE / 2 + i * (BADGE + BADGE_GAP), 0);
            const plate = new Graphics();
            drawBadge(plate, spec);
            const overlay = new Graphics();
            drawBadgeOverlay(overlay, spec);
            holder.addChild(plate, overlay);
            row.box.addChild(holder);
            row.items.push({ overlay, spec, startedAt, completesAt });
          });
          if (n > 0) row.box.hitArea = new Rectangle(-total / 2, -BADGE / 2, total, BADGE);
          row.box.visible = shape.detail && sc >= 0.9 && n > 0;
          row.box.scale.set(0.9 / sc);
          row.box.position.set(geo.center.x, geo.center.y - 38 / sc);
        }
      }

      // Mountains, trees and dunes belong to the terrain map only; on the political map they just add noise.
      if (mode === 'terrain') drawTerrainMarks(shape.g, geo.polygon, geo.terrain, geo.key.length * 7919 + geo.key.charCodeAt(0));
      }

      const parts: string[] = [];
      if (capitalKeys.has(geo.key)) parts.push('★');
      const text = parts.join(' ');
      if (text !== shape.labelText) {
        shape.labelText = text;
        if (shape.label) shape.label.text = text;
        else if (text) ctx.makeLabel(geo, shape);
      }
    }
  }, [ready, provinces, countries, myCountryId, mode, atWarWith, selectedKey, relationByCountry, supplyShort]);

  // Front lines: a coloured line along the border of every country your armies hold a front against, and a green
  // line along the border of the country being chosen while you assign one.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !ready) return;
    const g = ctx.frontG;
    g.clear();
    const owner = PROVINCES.map((geo) => ownerOfRef.current.get(geo.key) ?? '');
    const edgesTo = (target: string) => sharedEdges().filter((e) => (owner[e.a] === myCountryId && owner[e.b] === target) || (owner[e.b] === myCountryId && owner[e.a] === target));
    const fronts = new Set(formations.map((f) => f.frontCountryId).filter((id): id is string => !!id));
    const colorFor = (id: string) => {
      let h = 0;
      for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const hue = h % 360;
      // hsl(hue, 85%, 55%) to rgb
      const a = 0.85 * Math.min(0.55, 1 - 0.55);
      const f = (n: number) => { const k = (n + hue / 30) % 12; return 0.55 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
      return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
    };
    for (const id of fronts) {
      for (const e of edgesTo(id)) g.moveTo(e.x1, e.y1).lineTo(e.x2, e.y2);
      g.stroke({ width: 3.2, color: colorFor(id), alpha: 0.95 });
    }
    if (frontTarget) {
      for (const e of edgesTo(frontTarget)) g.moveTo(e.x1, e.y1).lineTo(e.x2, e.y2);
      g.stroke({ width: 6, color: 0x3ddc5a, alpha: 0.35 });
      for (const e of edgesTo(frontTarget)) g.moveTo(e.x1, e.y1).lineTo(e.x2, e.y2);
      g.stroke({ width: 2.4, color: 0x3ddc5a, alpha: 1 });
    }
  }, [ready, provinces, formations, frontTarget, myCountryId]);

  return <div ref={hostRef} className="map-host" />;
}
