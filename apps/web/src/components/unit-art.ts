/**
 * Optional unit artwork: transparent PNGs in apps/web/public/units/. Each unit looks for its own file,
 * then a shared fallback (both tanks can share tank.png). Anything missing falls back to the drawn figures.
 */
import type { UnitType } from '@cw/shared';

const CANDIDATES: Record<UnitType, string[]> = {
  infantry: ['infantry'],
  artillery: ['artillery'],
  light_tank: ['light_tank', 'tank'],
  heavy_tank: ['heavy_tank', 'tank'],
  fighter: ['fighter'],
  bomber: ['bomber'],
  air_support: ['air_support', 'support'],
  submarine: ['submarine'],
  destroyer: ['destroyer'],
  corvette: ['corvette', 'destroyer'],
  cruiser: ['cruiser'],
  battleship: ['battleship'],
};

export const unitArtUrls = (type: UnitType): string[] => (CANDIDATES[type] ?? [type]).map((n) => `/units/${n}.png`);
