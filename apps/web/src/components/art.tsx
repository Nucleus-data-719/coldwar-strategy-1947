import { useState, type ReactNode } from 'react';
import { unitArtUrls } from './unit-art';
import type { BuildingType, UnitType } from '@cw/shared';

/**
 * Period art for the game: unit silhouettes, building icons and national flags, all drawn as SVG.
 * Units are drawn like 1940s recognition silhouettes; flags are the ones in use around 1947.
 */

const UNIT_ART: Record<UnitType, ReactNode> = {
  // Soldier in a M1-style helmet carrying a rifle.
  infantry: (
    <>
      <path d="M8 5.5a3.2 3.2 0 0 1 6.4 0z" />
      <circle cx="11.2" cy="7.6" r="1.7" />
      <path d="M7.6 10.2h7.2l1 6.2-2.3.5-.3 5.6h-2.3v-4.4h-.2v4.4H8.4l-.3-5.6-2.3-.5z" />
      <path d="M15 9.4l6.6-3.3.5 1.1-5.6 3.6z" />
    </>
  ),
  artillery: (
    <>
      <path d="M2 14.5l16-6.2.8 2-16 6.2z" />
      <circle cx="9" cy="17.8" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14.5 18.5h7v1.6h-7z" />
      <path d="M17 13.5l3.5 5" strokeWidth="1.6" stroke="currentColor" fill="none" />
    </>
  ),
  light_tank: (
    <>
      <path d="M3 14.5h17l-1.4 4.5H5z" />
      <path d="M5 18.7h13.6" strokeWidth="2.6" stroke="currentColor" strokeLinecap="round" />
      <path d="M7.5 14.5l1.2-3.6h6.2l1.4 3.6z" />
      <path d="M14.5 11.6l7.5-1.2v1.2l-7.5 1.2z" />
    </>
  ),
  heavy_tank: (
    <>
      <path d="M2 13.5h19.5L20 19H3.6z" />
      <path d="M3.6 19h16.6" strokeWidth="3.2" stroke="currentColor" strokeLinecap="round" />
      <path d="M6 13.5l1.4-4.4h8.6l1.6 4.4z" />
      <path d="M15.5 10l8-1.6v1.8l-8 1.6z" />
      <rect x="9" y="7.4" width="3.2" height="1.8" />
    </>
  ),
  fighter: (
    <>
      <path d="M12 2l1.2 7.2 8.8 5v2.2l-8.8-2.2L13 19l2.8 2v1.2L12 21l-3.8 1.2V21L11 19l-.2-4.8-8.8 2.2v-2.2l8.8-5z" />
    </>
  ),
  bomber: (
    <>
      <path d="M12 1.5l1 6.5 10.5 3.5v2.5L13 12.8l.2 5 3.6 2.2v2.2L12 21l-4.8 1.2V20l3.6-2.2.2-5L.5 14V11.5L11 8z" />
      <circle cx="6.6" cy="11.2" r="0.9" fill="#000" fillOpacity="0.5" />
      <circle cx="17.4" cy="11.2" r="0.9" fill="#000" fillOpacity="0.5" />
    </>
  ),
  air_support: (
    <>
      <path d="M12 3l1.1 6.2 8.4 3.3v2L13 13.4l.3 4.6 2.5 1.6v1.6L12 19.8 8.2 21.2v-1.6L10.7 18l.3-4.6-8.5 1.1v-2l8.4-3.3z" />
      <path d="M12 21.6v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  submarine: (
    <>
      <path d="M1.5 15.5c0-2.4 2.6-3.7 6-3.7h9.4c3.2 0 5.6 1.3 5.6 3.7s-2.4 3.7-5.6 3.7H7.5c-3.4 0-6-1.3-6-3.7z" />
      <path d="M9.5 11.8V8.2h5v3.6" />
      <path d="M12 8.2V4.6h2.6" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </>
  ),
  destroyer: (
    <>
      <path d="M1.5 14.5h21l-3 4.2H4.4z" />
      <path d="M8 14.5v-3h3.4v3M13 14.5V9.4h2v5.1" />
      <path d="M4 12.6l3.8 1.9M17.8 13.2h4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 20.5c2 .9 3 .9 5 0s3-.9 5 0 3 .9 4 .3" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </>
  ),
  corvette: (
    <>
      <path d="M2.5 15h19l-2.6 3.8H5.2z" />
      <path d="M9 15v-3h3.2v3M14 15v-4.4h1.8V15" />
      <path d="M4.6 13.2l3.6 1.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 20.4c2 .8 3 .8 5 0s3-.8 5 0 3 .8 4 .3" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </>
  ),
  cruiser: (
    <>
      <path d="M1 14h22l-3.2 4.8H4.2z" />
      <path d="M7.5 14v-3.2h3.2V14M12 14V8.6h2.4V14M16 14v-2.6h2.6V14" />
      <path d="M3 12.4l4.2 1.4M19.2 12.2l3.6.9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 20.7c2 .9 3 .9 5 0s3-.9 5 0 3 .9 4 .3" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </>
  ),
  battleship: (
    <>
      <path d="M.5 13.6h23l-3.4 5.2H3.9z" />
      <path d="M5 13.6v-2.4h4v2.4M10.2 13.6V6.8h3.4v6.8M15.2 13.6v-2.4h4v2.4" />
      <path d="M1.5 11.6l3.5.8M19.2 12.2l4 -.6M8.2 10l-4-1M16.5 10l4-1" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 20.7c2 .9 3 .9 5 0s3-.9 5 0 3 .9 4 .3" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </>
  ),
};

export function UnitIcon({ type, size = 22 }: { type: UnitType; size?: number }) {
  // Use the artwork in public/units when present; otherwise the drawn silhouette.
  const urls = unitArtUrls(type);
  const [tried, setTried] = useState(0);
  if (tried < urls.length) {
    return (
      <img
        className="unit-art"
        src={urls[tried]}
        width={size}
        height={size}
        alt=""
        draggable={false}
        onError={() => setTried(tried + 1)}
      />
    );
  }
  return (
    <svg className="unit-icon" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {UNIT_ART[type]}
    </svg>
  );
}

const BUILDING_ART: Record<BuildingType, ReactNode> = {
  // Saw-tooth factory roof with chimney and smoke.
  local_factory: (
    <>
      <path d="M3 20V11l5 3v-3l5 3v-3l5 3V6h3v14z" />
      <path d="M19 3.5c1 .6 1 1.4 0 2" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </>
  ),
  // Barracks with a flag.
  recruitment_center: (
    <>
      <path d="M3 20v-8l8-4 8 4v8z" />
      <path d="M10 20v-5h2v5" stroke="#000" strokeOpacity="0.45" strokeWidth="1" fill="none" />
      <path d="M11 8V2.5l5 1.5-5 1.5" />
    </>
  ),
  // Gear.
  military_factory: (
    <>
      <path d="M10.5 2h3l.5 2.6 2 .9 2.2-1.5 2.1 2.1-1.5 2.2.9 2L22 11v3l-2.6.5-.9 2 1.5 2.2-2.1 2.1-2.2-1.5-2 .9L13.5 22h-3l-.5-2.6-2-.9-2.2 1.5-2.1-2.1 1.5-2.2-.9-2L2 13.5v-3l2.6-.5.9-2L4 5.8l2.1-2.1L8.3 5.2l2-.9z" />
      <circle cx="12" cy="12" r="3.2" fill="#000" fillOpacity="0.5" />
    </>
  ),
  // Anchor.
  harbor: (
    <>
      <circle cx="12" cy="5" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v13M7.5 10.5h9" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <path d="M4 14c0 4 3.5 6.5 8 6.5s8-2.5 8-6.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </>
  ),
  // Runway with a plane.
  airbase: (
    <>
      <path d="M12 2l1 5 7 3.6V13l-7-1.8.3 4.3 2.2 1.6V19L12 18l-3.5 1v-1.9l2.2-1.6.3-4.3-7 1.8v-2.4L11 7z" />
      <path d="M10 21.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  research_lab: (
    <>
      <path d="M9 3h6v1.6h-1.2v5.2L19 19a1.4 1.4 0 0 1-1.2 2H6.2A1.4 1.4 0 0 1 5 19l5.2-9.2V4.6H9z" />
      <path d="M7.6 15.5h8.8" stroke="#000" strokeOpacity="0.45" strokeWidth="1.2" />
    </>
  ),
  // Columns and pediment.
  university: (
    <>
      <path d="M2 9l10-6 10 6v1.6H2z" />
      <path d="M4.5 12h2.6v6.5H4.5zM10.7 12h2.6v6.5h-2.6zM16.9 12h2.6v6.5h-2.6z" />
      <path d="M2.5 19.5h19V22h-19z" />
    </>
  ),
  // Castle wall.
  fortress: (
    <>
      <path d="M3 21V7h3v2h2V7h2v2h4V7h2v2h2V7h3v14z" />
      <path d="M10 21v-5a2 2 0 0 1 4 0v5" fill="#000" fillOpacity="0.5" />
    </>
  ),
  // Rails and sleepers.
  railway: (
    <>
      <path d="M7 2.5L4 21.5M17 2.5l3 19" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M6 8h12M5.2 13.5h13.6M4.4 19h15.2" stroke="currentColor" strokeWidth="2" fill="none" />
    </>
  ),
};

export function BuildingIcon({ type, size = 22 }: { type: BuildingType; size?: number }) {
  return (
    <svg className="building-icon" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {BUILDING_ART[type]}
    </svg>
  );
}

/* ---------------------------- Flags ---------------------------- */

const W = 30;
const H = 20;

type FlagArt = (c: string) => ReactNode;

const stripesH = (cols: string[]): ReactNode =>
  cols.map((col, i) => <rect key={i} x="0" y={(H / cols.length) * i} width={W} height={H / cols.length + 0.2} fill={col} />);
const stripesV = (cols: string[]): ReactNode =>
  cols.map((col, i) => <rect key={i} x={(W / cols.length) * i} y="0" width={W / cols.length + 0.2} height={H} fill={col} />);

function star(cx: number, cy: number, r: number, fill: string): ReactNode {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.4;
    pts.push(`${(cx + Math.cos(a) * rad).toFixed(2)},${(cy + Math.sin(a) * rad).toFixed(2)}`);
  }
  return <polygon points={pts.join(' ')} fill={fill} />;
}

/** Flags used around 1947. Regional blocs without a single historic flag get an emblem banner (see below). */
const FLAGS: Record<string, FlagArt> = {
  // Soviet Union: red, gold hammer-and-sickle star.
  SOV: () => (
    <>
      <rect width={W} height={H} fill="#cc0000" />
      {star(6, 5.2, 3, '#ffd700')}
      <path d="M4.2 8.5c1.4.2 3.2.2 4.6-.6" stroke="#ffd700" strokeWidth="0.8" fill="none" />
    </>
  ),
  // United States: stripes and a star field.
  USA: () => (
    <>
      <rect width={W} height={H} fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((i) => (
        <rect key={i} x="0" y={(H / 13) * i} width={W} height={H / 13} fill="#b22234" />
      ))}
      <rect width="13" height={(H / 13) * 7} fill="#3c3b6e" />
      {[0, 1, 2, 3].flatMap((r) => [0, 1, 2].map((c) => <circle key={`${r}${c}`} cx={2.5 + c * 4 + (r % 2) * 1.5} cy={1.8 + r * 2.1} r="0.7" fill="#fff" />))}
    </>
  ),
  // United Kingdom: Union Jack.
  GBR: () => (
    <>
      <rect width={W} height={H} fill="#012169" />
      <path d={`M0 0L${W} ${H}M${W} 0L0 ${H}`} stroke="#fff" strokeWidth="4" />
      <path d={`M0 0L${W} ${H}M${W} 0L0 ${H}`} stroke="#c8102e" strokeWidth="1.4" />
      <path d={`M${W / 2} 0V${H}M0 ${H / 2}H${W}`} stroke="#fff" strokeWidth="6" />
      <path d={`M${W / 2} 0V${H}M0 ${H / 2}H${W}`} stroke="#c8102e" strokeWidth="3.4" />
    </>
  ),
  FRA: () => <>{stripesV(['#002654', '#ffffff', '#ce1126'])}</>,
  // Republic of China, 1947: blue canton with a white sun on red.
  CHN: () => (
    <>
      <rect width={W} height={H} fill="#de2910" />
      <rect width="15" height="10" fill="#002395" />
      <circle cx="7.5" cy="5" r="2.6" fill="#fff" />
      <circle cx="7.5" cy="5" r="1.5" fill="#002395" />
      <circle cx="7.5" cy="5" r="1.1" fill="#fff" />
    </>
  ),
  // India, 1947: saffron, white, green with a wheel.
  IND: () => (
    <>
      {stripesH(['#ff9933', '#ffffff', '#138808'])}
      <circle cx="15" cy="10" r="2.5" fill="none" stroke="#000080" strokeWidth="0.6" />
      <path d="M15 7.5v5M12.5 10h5M13.2 8.2l3.6 3.6M16.8 8.2l-3.6 3.6" stroke="#000080" strokeWidth="0.4" />
    </>
  ),
  // Turkey: red with white crescent and star.
  TUR: () => (
    <>
      <rect width={W} height={H} fill="#e30a17" />
      <circle cx="11.5" cy="10" r="4.8" fill="#fff" />
      <circle cx="12.9" cy="10" r="3.9" fill="#e30a17" />
      {star(17, 10, 2.1, '#fff')}
    </>
  ),
  // Brazil: green field, yellow rhombus, blue disc.
  BRA: () => (
    <>
      <rect width={W} height={H} fill="#009c3b" />
      <path d={`M${W / 2} 2L${W - 3} ${H / 2}L${W / 2} ${H - 2}L3 ${H / 2}z`} fill="#ffdf00" />
      <circle cx={W / 2} cy={H / 2} r="4.2" fill="#002776" />
    </>
  ),
  // Poland: white over red.
  POL: () => <>{stripesH(['#ffffff', '#dc143c'])}</>,
  // Egypt (kingdom): green, white crescent and three stars.
  EGY: () => (
    <>
      <rect width={W} height={H} fill="#0b6b2f" />
      <circle cx="10" cy="10" r="5.2" fill="#fff" />
      <circle cx="11.6" cy="10" r="4.4" fill="#0b6b2f" />
      {star(15, 6, 1.5, '#fff')}
      {star(17.5, 10, 1.5, '#fff')}
      {star(15, 14, 1.5, '#fff')}
    </>
  ),
  // Sweden: yellow Nordic cross on blue.
  SWE: () => (
    <>
      <rect width={W} height={H} fill="#006aa7" />
      <rect x="9" width="4" height={H} fill="#fecc00" />
      <rect y="8" width={W} height="4" fill="#fecc00" />
    </>
  ),
  // Japan: red disc on white.
  JPN: () => (
    <>
      <rect width={W} height={H} fill="#fff" />
      <circle cx={W / 2} cy={H / 2} r="5.6" fill="#bc002d" />
    </>
  ),
};

/** Deterministic number from a country code, to vary the emblem banners. */
const hash = (s: string) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);

/** Banner for blocs that are not a single historic state: the bloc colour with a field pattern and a star. */
function bloc(code: string, color: string): ReactNode {
  const h = hash(code);
  const dark = 'rgba(0,0,0,0.38)';
  const light = 'rgba(255,255,255,0.85)';
  const base = <rect width={W} height={H} fill={color} />;
  switch (h % 4) {
    case 0:
      return (
        <>
          {base}
          <rect y={H / 3} width={W} height={H / 3} fill={light} />
          {star(W / 2, H / 2, 3.4, color)}
        </>
      );
    case 1:
      return (
        <>
          {base}
          <path d={`M0 0L${W / 2} ${H / 2}L0 ${H}z`} fill={dark} />
          {star(W * 0.68, H / 2, 4, light)}
        </>
      );
    case 2:
      return (
        <>
          {base}
          <rect x={W / 3} width={W / 3} height={H} fill={dark} />
          {star(W / 2, H / 2, 3.4, light)}
        </>
      );
    default:
      return (
        <>
          {base}
          <path d={`M0 ${H}L${W} 0V${H * 0.45}L${W * 0.35} ${H}z`} fill={dark} />
          {star(7, 6, 3.4, light)}
        </>
      );
  }
}

export function Flag({ code, color = '#5a6b7d', width = 30 }: { code: string; color?: string; width?: number }) {
  const art = FLAGS[code];
  const h = (width * H) / W;
  return (
    <svg className="flag" width={width} height={h} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Flag of ${code}`}>
      <defs>
        <clipPath id={`clip-${code}`}>
          <rect width={W} height={H} rx="1.6" />
        </clipPath>
      </defs>
      <g clipPath={`url(#clip-${code})`}>{art ? art(color) : bloc(code, color)}</g>
      <rect width={W} height={H} rx="1.6" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />
    </svg>
  );
}
