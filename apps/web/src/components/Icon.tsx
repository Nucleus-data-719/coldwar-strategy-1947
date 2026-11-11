import type { ReactNode } from 'react';
import type { ResourceKey } from '@cw/shared';

/** UI icons: simple outlines that take the colour of the text around them. */
const PATHS: Record<string, ReactNode> = {
  world: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3.2 3.4 3.2 14.6 0 18M12 3c-3.2 3.4-3.2 14.6 0 18" />
    </>
  ),
  economy: <path d="M4 20V11M10 20V4M16 20v-6M2 20h20" />,
  research: (
    <>
      <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" />
      <path d="M7.5 14.5h9" />
    </>
  ),
  generals: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  diplomacy: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 17v-6a6 6 0 1 1 12 0v6l2 2H4z" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M15 5l-7 7 7 7" />,
  logout: (
    <>
      <path d="M10 4H5v16h5" />
      <path d="M15 8l4 4-4 4M19 12H9" />
    </>
  ),
  report: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.5" />
    </>
  ),
  province: (
    <>
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  armies: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  battles: (
    <>
      <path d="M5 4l10 10M19 4L9 14" />
      <path d="M4 17l3 3M20 17l-3 3M3 21l3-3M21 21l-3-3" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  soundOff: (
    <>
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M17 9l5 6M22 9l-5 6" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1.1.9-1.1 1.8M12 17v.3" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Same pictures as on the map. Drawn in a 18x18 box centred on 0,0. */
export function ResourceIcon({ kind, size = 22 }: { kind: ResourceKey; size?: number }) {
  let shape: ReactNode;
  switch (kind) {
    case 'oil':
      shape = (
        <>
          <path d="M0 -7.5 L3.9 0.6 A4.4 4.4 0 1 1 -3.9 0.6 Z" fill="#20252b" stroke="#c8d2dc" strokeWidth="0.9" />
          <circle cx="-1.5" cy="1.4" r="1.1" fill="#8aa0b4" />
        </>
      );
      break;
    case 'steel':
      shape = (
        <>
          <path d="M-6.5 4 L-4.3 -4 L4.3 -4 L6.5 4 Z" fill="#aab4c0" stroke="#56616d" strokeWidth="0.9" />
          <path d="M-4.3 -4 L4.3 -4 L3.3 -1.2 L-3.3 -1.2 Z" fill="#dde4ec" />
        </>
      );
      break;
    case 'electronics':
      shape = (
        <>
          <rect x="-5" y="-5" width="10" height="10" rx="1.6" fill="#3ddc84" stroke="#0f5a32" strokeWidth="0.9" />
          <rect x="-2.2" y="-2.2" width="4.4" height="4.4" rx="0.6" fill="#0f5a32" />
          <path d="M-3 -5 V-7 M0 -5 V-7 M3 -5 V-7 M-3 5 V7 M0 5 V7 M3 5 V7" stroke="#bfe9d0" strokeWidth="1" />
        </>
      );
      break;
    case 'rare':
      shape = (
        <>
          <path d="M0 -7 L5.3 -1 L0 7 L-5.3 -1 Z" fill="#ff8a1f" stroke="#ffe0b8" strokeWidth="0.9" />
          <path d="M-5.3 -1 L0 -7 L5.3 -1 L0 0 Z" fill="#ffc277" />
        </>
      );
      break;
    case 'wood':
      shape = (
        <>
          <rect x="-6" y="-7.5" width="12" height="4.4" rx="2.2" fill="#c88a4a" stroke="#5a3716" strokeWidth="0.9" />
          <rect x="-6" y="-2.4" width="12" height="4.8" rx="2.4" fill="#b5783a" stroke="#5a3716" strokeWidth="0.9" />
          <rect x="-6" y="3.1" width="12" height="4.4" rx="2.2" fill="#a06a32" stroke="#5a3716" strokeWidth="0.9" />
        </>
      );
      break;
    case 'money':
      shape = (
        <>
          <circle r="6" fill="#f2c14e" stroke="#8a6a10" strokeWidth="0.9" />
          <circle r="3.2" fill="none" stroke="#8a6a10" strokeWidth="0.9" />
        </>
      );
      break;
    case 'food':
      shape = (
        <>
          <path d="M0 -7 L4.6 -1 L0 7 L-4.6 -1 Z" fill="#7cc45c" stroke="#2f6b1c" strokeWidth="0.9" />
          <path d="M0 -6 V6" stroke="#2f6b1c" strokeWidth="0.9" />
        </>
      );
      break;
    case 'manpower':
      shape = (
        <>
          <circle cx="0" cy="-4" r="3" fill="#6fa8ff" />
          <path d="M-5 7 L-4 0.5 L4 0.5 L5 7 Z" fill="#6fa8ff" />
        </>
      );
      break;
  }
  return (
    <svg className="res-icon" width={size} height={size} viewBox="-9 -9 18 18" aria-hidden="true">
      {shape}
    </svg>
  );
}

/** Round badge used as the game's crest. */
export function Crest({ size = 40 }: { size?: number }) {
  return (
    <svg className="crest" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="21" fill="#101b27" stroke="#c9a227" strokeWidth="2" />
      <circle cx="24" cy="24" r="16" fill="none" stroke="#c9a227" strokeWidth="0.8" strokeDasharray="2 3" />
      <path d="M24 10l3.6 8.2 8.9.8-6.7 5.9 2 8.7L24 28.8l-7.8 4.8 2-8.7-6.7-5.9 8.9-.8z" fill="#c9a227" />
    </svg>
  );
}
