import { useEffect, useRef, useState } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  PROVINCES,
  PROVINCE_BY_KEY,
  type FormationDto,
  type StateCountry,
  type StateProvince,
} from '@cw/shared';

interface Props {
  provinces: StateProvince[];
  countries: StateCountry[];
  myCountryId: string;
  /** Countries you are at war with: their provinces get a red outline. */
  atWarWith: string[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** Your armies. Those with a movement are drawn as markers travelling along their route. */
  formations: FormationDto[];
  /** Server time minus browser time, so markers follow the server clock. */
  clockOffsetMs: number;
  /** Route being previewed while giving a move order. */
  previewPath: string[] | null;
}

interface Shape {
  g: Graphics;
  label: Text;
}

interface Ctx {
  app: Application;
  world: Container;
  shapes: Map<string, Shape>;
  dispose: () => void;
}

const hex = (c: string) => parseInt(c.replace('#', ''), 16);
const centerOf = (key: string) => PROVINCE_BY_KEY[key].center;

/** Interactive PixiJS map. Geometry comes from shared map data; ownership comes from the server. */
export function WorldMap({
  provinces,
  countries,
  myCountryId,
  atWarWith,
  selectedKey,
  onSelect,
  formations,
  clockOffsetMs,
  previewPath,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const dragMoved = useRef(false);
  const onSelectRef = useRef(onSelect);
  const formationsRef = useRef(formations);
  const offsetRef = useRef(clockOffsetMs);
  const previewRef = useRef(previewPath);
  onSelectRef.current = onSelect;
  formationsRef.current = formations;
  offsetRef.current = clockOffsetMs;
  previewRef.current = previewPath;
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

        const shapes = new Map<string, Shape>();
        for (const geo of PROVINCES) {
          const g = new Graphics();
          g.eventMode = 'static';
          g.cursor = 'pointer';
          g.on('pointertap', () => {
            if (!dragMoved.current) onSelectRef.current(geo.key);
          });
          world.addChild(g);
          shapes.set(geo.key, { g, label: null as unknown as Text });
        }
        // Labels are added after all shapes so neighbours never paint over them.
        for (const geo of PROVINCES) {
          const label = new Text({
            text: '',
            style: {
              fontSize: 13,
              fill: 0xffffff,
              fontFamily: 'sans-serif',
              stroke: { color: 0x000000, width: 3 },
            },
          });
          label.anchor.set(0.5);
          label.position.set(geo.center.x, geo.center.y);
          label.eventMode = 'none';
          world.addChild(label);
          shapes.get(geo.key)!.label = label;
        }

        // Army layer: route preview, travelling markers. Redrawn every frame from server times.
        const armyLayer = new Container();
        armyLayer.eventMode = 'none';
        world.addChild(armyLayer);
        const routeG = new Graphics();
        armyLayer.addChild(routeG);
        const armyTexts = new Map<string, Text>();

        const drawArmies = () => {
          const now = Date.now() + offsetRef.current;
          routeG.clear();

          const preview = previewRef.current;
          if (preview && preview.length > 0) {
            const first = centerOf(preview[0]);
            routeG.moveTo(first.x, first.y);
            for (const key of preview.slice(1)) {
              const c = centerOf(key);
              routeG.lineTo(c.x, c.y);
            }
            routeG.stroke({ width: 3, color: 0xffffff, alpha: 0.9 });
            const last = centerOf(preview[preview.length - 1]);
            routeG.circle(last.x, last.y, 10).stroke({ width: 2, color: 0xffffff });
          }

          const seen = new Set<string>();
          for (const f of formationsRef.current) {
            const m = f.movement;
            if (!m) continue;
            const a = centerOf(f.provinceKey);
            const b = centerOf(m.toKey);
            const start = Date.parse(m.startedAt);
            const end = Date.parse(m.arrivesAt);
            const t = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 1;
            const x = a.x + (b.x - a.x) * t;
            const y = a.y + (b.y - a.y) * t;

            routeG.moveTo(x, y).lineTo(b.x, b.y);
            for (const key of m.remainingKeys) {
              const c = centerOf(key);
              routeG.lineTo(c.x, c.y);
            }
            routeG.stroke({ width: 2, color: 0xffe27a, alpha: 0.85 });
            routeG.roundRect(x - 15, y - 10, 30, 20, 5).fill({ color: 0x14202e }).stroke({ width: 2, color: 0xffe27a });

            let label = armyTexts.get(f.id);
            if (!label) {
              label = new Text({
                text: '',
                style: { fontSize: 12, fill: 0xffffff, fontFamily: 'sans-serif', fontWeight: 'bold' },
              });
              label.anchor.set(0.5);
              armyLayer.addChild(label);
              armyTexts.set(f.id, label);
            }
            const total = String(f.units.reduce((s, u) => s + u.count, 0));
            if (label.text !== total) label.text = total;
            label.position.set(x, y);
            seen.add(f.id);
          }
          for (const [id, label] of armyTexts) {
            if (!seen.has(id)) {
              armyLayer.removeChild(label);
              label.destroy();
              armyTexts.delete(id);
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
        const down = (e: PointerEvent) => {
          dragging = true;
          dragMoved.current = false;
          lastX = startX = e.clientX;
          lastY = startY = e.clientY;
        };
        const move = (e: PointerEvent) => {
          if (!dragging) return;
          if (Math.hypot(e.clientX - startX, e.clientY - startY) > 4) dragMoved.current = true;
          if (dragMoved.current) {
            world.x += e.clientX - lastX;
            world.y += e.clientY - lastY;
          }
          lastX = e.clientX;
          lastY = e.clientY;
        };
        const up = () => {
          dragging = false;
        };
        const wheel = (e: WheelEvent) => {
          e.preventDefault();
          const rect = canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const old = world.scale.x;
          const next = Math.min(6, Math.max(0.3, old * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
          const k = next / old;
          world.x = mx - (mx - world.x) * k;
          world.y = my - (my - world.y) * k;
          world.scale.set(next);
        };
        canvas.addEventListener('pointerdown', down);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        canvas.addEventListener('wheel', wheel, { passive: false });

        ctxRef.current = {
          app,
          world,
          shapes,
          dispose: () => {
            app.ticker.remove(drawArmies);
            canvas.removeEventListener('pointerdown', down);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
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

    for (const geo of PROVINCES) {
      const shape = ctx.shapes.get(geo.key);
      const st = stateByKey.get(geo.key);
      if (!shape || !st) continue;
      const mine = st.ownerCountryId === myCountryId;
      const selected = selectedKey === geo.key;
      const enemy = atWarSet.has(st.ownerCountryId);

      shape.g.clear();
      shape.g
        .poly(geo.polygon)
        .fill({ color: colorById.get(st.ownerCountryId) ?? 0x555555, alpha: mine ? 0.95 : 0.7 })
        .stroke({
          width: selected ? 4 : mine ? 2 : enemy ? 2 : 1,
          color: selected ? 0xffffff : mine ? 0xffe27a : enemy ? 0xe5483f : 0x0b1d2e,
        });

      const parts: string[] = [];
      if (capitalKeys.has(geo.key)) parts.push('★');
      if (st.unitCount > 0) parts.push(`⚔${st.unitCount}`);
      const done = st.buildings.filter((b) => b.status === 'complete').length;
      const building = st.buildings.length - done;
      if (done > 0) parts.push(`▣${done}`);
      if (building > 0) parts.push(`⏳${building}`);
      shape.label.text = parts.join(' ');
    }
  }, [ready, provinces, countries, myCountryId, atWarWith, selectedKey]);

  return <div ref={hostRef} className="map-host" />;
}
