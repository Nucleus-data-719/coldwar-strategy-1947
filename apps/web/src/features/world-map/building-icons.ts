import type { Graphics } from 'pixi.js';
import type { BuildingType } from '@cw/shared';

/** Size of one building badge on the map, and the gap between two. */
export const BADGE = 20;
export const BADGE_GAP = 3;

const INK = 0x101b27;
const GLYPH = 0xeef3f8;

/** A tiny pictogram for each building, about 12 units tall, centred on (0, 0). */
export function drawGlyph(g: Graphics, type: BuildingType, alpha = 1): void {
  const f = { color: GLYPH, alpha };
  const s = { width: 1.3, color: GLYPH, alpha };
  switch (type) {
    case 'local_factory':
      g.rect(-6, 0, 12, 6).fill(f);
      g.rect(-5, -6, 2.6, 6).fill(f);
      g.rect(0.2, -4, 2.6, 4).fill(f);
      g.poly([3, 0, 3, -3, 6, 0]).fill(f);
      break;
    case 'recruitment_center':
      g.poly([-6.5, 6, 0, -5, 6.5, 6]).fill(f);
      g.poly([-1.6, 6, 0, 0.5, 1.6, 6]).fill({ color: INK, alpha: 0.9 });
      g.moveTo(0, -5).lineTo(0, -8).stroke(s);
      g.poly([0, -8, 4, -7, 0, -5.8]).fill({ color: 0xe5584f, alpha });
      break;
    case 'military_factory': {
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        g.circle(Math.cos(a) * 5, Math.sin(a) * 5, 1.5).fill(f);
      }
      g.circle(0, 0, 4.4).fill(f);
      g.circle(0, 0, 1.8).fill({ color: INK, alpha: 0.95 });
      break;
    }
    case 'harbor':
      g.circle(0, -5, 1.7).stroke(s);
      g.moveTo(0, -3.3).lineTo(0, 5.5).stroke(s);
      g.moveTo(-3, -1).lineTo(3, -1).stroke(s);
      g.moveTo(-5.5, 1).quadraticCurveTo(0, 9, 5.5, 1).stroke(s);
      break;
    case 'airbase':
      g.poly([0, -7, 1.2, -1.5, 6.5, 2, 6.5, 3.6, 1.2, 2, 1, 5, 3, 6.6, 3, 7.6, 0, 6.8, -3, 7.6, -3, 6.6, -1, 5, -1.2, 2, -6.5, 3.6, -6.5, 2, -1.2, -1.5]).fill(f);
      break;
    case 'research_lab':
      g.poly([-1.6, -6.5, 1.6, -6.5, 1.6, -2, 5.5, 5.5, -5.5, 5.5, -1.6, -2]).fill(f);
      g.rect(-4, 2, 8, 1.4).fill({ color: INK, alpha: 0.9 });
      break;
    case 'university':
      g.poly([-6.5, -2, 0, -7, 6.5, -2]).fill(f);
      for (const x of [-4.4, -1, 2.4]) g.rect(x, -1, 2, 5.5).fill(f);
      g.rect(-6.5, 5, 13, 1.8).fill(f);
      break;
    case 'fortress':
      g.rect(-5.5, -2, 11, 8.5).fill(f);
      for (const x of [-5.5, -1.3, 2.9]) g.rect(x, -5.5, 2.6, 3.5).fill(f);
      g.poly([-1.8, 6.5, -1.8, 2.5, 0, 1, 1.8, 2.5, 1.8, 6.5]).fill({ color: INK, alpha: 0.95 });
      break;
    case 'railway':
      g.moveTo(-3, -6.5).lineTo(-3, 6.5).stroke(s);
      g.moveTo(3, -6.5).lineTo(3, 6.5).stroke(s);
      for (const y of [-5, -1.7, 1.6, 4.9]) g.moveTo(-5, y).lineTo(5, y).stroke({ width: 1.1, color: GLYPH, alpha: alpha * 0.8 });
      break;
  }
}

export interface BadgeSpec {
  type: BuildingType;
  constructing: boolean;
  /** Bomb damage 0-100. */
  damage: number;
  /** Construction progress 0-1, for the progress bar. */
  progress: number;
  ownerColor: number;
}

/** One building badge: a dark plate in the owner's colour with the pictogram, a progress bar while it is being built, red when bombed. */
export function drawBadge(g: Graphics, b: BadgeSpec): void {
  const h = BADGE / 2;
  const down = b.damage >= 50;
  g.roundRect(-h, -h, BADGE, BADGE, 4).fill({ color: INK, alpha: b.constructing ? 0.6 : 0.88 });
  g.roundRect(-h, -h, BADGE, BADGE, 4).stroke({ width: 1.6, color: down ? 0xe5483f : b.constructing ? 0xffe27a : b.ownerColor, alpha: b.constructing ? 0.8 : 1 });
}

/** The part of a badge that changes with time or damage: pictogram, progress bar, damage bar, knocked-out cross. */
export function drawBadgeOverlay(g: Graphics, b: BadgeSpec): void {
  const h = BADGE / 2;
  g.clear();
  if (b.constructing) {
    // Scaffold look: the pictogram is faint and a bar fills along the bottom.
    drawGlyph(g, b.type, 0.35);
    g.rect(-h + 2, h - 5, BADGE - 4, 3).fill({ color: 0x000000, alpha: 0.7 });
    g.rect(-h + 2, h - 5, (BADGE - 4) * Math.min(1, Math.max(0, b.progress)), 3).fill({ color: 0xffe27a });
    return;
  }
  drawGlyph(g, b.type, b.damage >= 50 ? 0.45 : 1);
  if (b.damage > 0 && b.damage < 50) {
    g.rect(-h + 2, -h + 2, BADGE - 4, 2.4).fill({ color: 0x000000, alpha: 0.7 });
    g.rect(-h + 2, -h + 2, (BADGE - 4) * (b.damage / 50), 2.4).fill({ color: 0xe5483f });
  }
  if (b.damage >= 50) {
    g.moveTo(-h + 3, -h + 3).lineTo(h - 3, h - 3).stroke({ width: 2, color: 0xe5483f });
    g.moveTo(h - 3, -h + 3).lineTo(-h + 3, h - 3).stroke({ width: 2, color: 0xe5483f });
  }
}
