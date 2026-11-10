import type { Graphics } from 'pixi.js';

/**
 * The look of an army on the map: a small figure (soldier, tank, gun, aircraft or ship) standing on a
 * NATO-style plate that shows the owner's colour, the main unit symbol and, beside it, the unit count.
 * Everything is drawn around (0, 0), the middle of the plate, so the map can move and scale the token as one object.
 */

export type UnitClass = 'infantry' | 'armor' | 'artillery' | 'air' | 'naval';

const CLASS_OF: Record<string, UnitClass> = {
  infantry: 'infantry', artillery: 'artillery', light_tank: 'armor', heavy_tank: 'armor',
  fighter: 'air', bomber: 'air', air_support: 'air',
  submarine: 'naval', destroyer: 'naval', cruiser: 'naval', battleship: 'naval',
};

/** The kind of unit that makes up most of a formation decides its figure and symbol. */
export function formationClass(units: { unitType: string; count: number }[]): UnitClass {
  const totals: Record<UnitClass, number> = { infantry: 0, armor: 0, artillery: 0, air: 0, naval: 0 };
  for (const u of units) totals[CLASS_OF[u.unitType] ?? 'infantry'] += u.count;
  return (Object.keys(totals) as UnitClass[]).sort((a, b) => totals[b] - totals[a])[0];
}

export const TOKEN_HALF_WIDTH = 18;
/** Top of the figure, bottom of the plate (local coordinates). */
export const TOKEN_TOP = -36;
export const TOKEN_BOTTOM = 11;

const OUTLINE = 0xffffff;
const INK = 0x101b27;

function figure(g: Graphics, cls: UnitClass, owner: number) {
  const body = { color: owner };
  const edge = { width: 1.2, color: OUTLINE };
  switch (cls) {
    case 'infantry': {
      // Soldier in a steel helmet, rifle at the shoulder.
      g.moveTo(3, -22).lineTo(13, -29).stroke({ width: 2, color: OUTLINE });
      g.moveTo(3, -22).lineTo(13, -29).stroke({ width: 0.9, color: INK });
      g.roundRect(-4, -24, 8, 10, 2).fill(body).stroke(edge);
      g.rect(-4, -15, 3.2, 5).fill(body).stroke(edge);
      g.rect(0.8, -15, 3.2, 5).fill(body).stroke(edge);
      g.circle(0, -28, 3.1).fill({ color: 0xe8c9a0 }).stroke(edge);
      g.poly([-4.2, -28.5, -3, -32.6, 3, -32.6, 4.2, -28.5]).fill(body).stroke(edge);
      break;
    }
    case 'armor': {
      g.roundRect(-13, -19, 26, 8, 3).fill(body).stroke(edge);
      g.roundRect(-12, -14.5, 24, 4.5, 2).fill({ color: INK }).stroke(edge);
      g.roundRect(-6, -27, 12, 8.5, 3).fill(body).stroke(edge);
      g.rect(5, -25, 14, 2.6).fill(body).stroke(edge);
      break;
    }
    case 'artillery': {
      g.moveTo(-8, -14).lineTo(14, -29).stroke({ width: 4.4, color: OUTLINE });
      g.moveTo(-8, -14).lineTo(14, -29).stroke({ width: 2.6, color: owner });
      g.circle(-5, -14, 6).fill({ color: INK }).stroke(edge);
      g.circle(-5, -14, 1.8).fill({ color: owner });
      g.moveTo(-5, -14).lineTo(-15, -10).stroke({ width: 2, color: OUTLINE });
      break;
    }
    case 'air': {
      // Aircraft seen from above.
      g.poly([0, -36, 2.4, -26, 15, -22, 15, -18.6, 2.4, -20.6, 1.8, -14, 6, -11.6, 6, -9.6, 0, -11.4, -6, -9.6, -6, -11.6, -1.8, -14, -2.4, -20.6, -15, -18.6, -15, -22, -2.4, -26])
        .fill(body)
        .stroke(edge);
      break;
    }
    case 'naval': {
      // Warship in profile with a superstructure and a gun.
      g.poly([-16, -17, 16, -17, 11, -11.5, -12, -11.5]).fill(body).stroke(edge);
      g.rect(-5, -24, 8, 7).fill(body).stroke(edge);
      g.rect(-1.5, -30, 2.4, 6).fill(body).stroke(edge);
      g.moveTo(-9, -19).lineTo(-15, -21.5).stroke({ width: 2, color: OUTLINE });
      g.moveTo(8, -19).lineTo(15, -22).stroke({ width: 2, color: OUTLINE });
      break;
    }
  }
}

/** Draws the whole token into an empty Graphics. Call `g.clear()` first when redrawing. */
export function drawToken(g: Graphics, owner: number, cls: UnitClass, selected: boolean) {
  if (selected) {
    g.roundRect(-TOKEN_HALF_WIDTH - 4, TOKEN_TOP - 4, TOKEN_HALF_WIDTH * 2 + 8, TOKEN_BOTTOM - TOKEN_TOP + 8, 6).stroke({ width: 2.4, color: 0xffe27a });
  }
  figure(g, cls, owner);

  // Plate.
  g.roundRect(-17, -10, 34, 20, 3).fill({ color: INK }).stroke({ width: 1.6, color: 0xffe27a });
  g.rect(-15.5, -8.5, 31, 3.5).fill({ color: owner });

  // NATO-style symbol of the main unit type, left of the count.
  const sx = -9;
  const sy = 2;
  const line = { width: 1.4, color: 0xffffff };
  switch (cls) {
    case 'infantry':
      g.moveTo(sx - 6, sy - 4).lineTo(sx + 6, sy + 4).moveTo(sx + 6, sy - 4).lineTo(sx - 6, sy + 4).stroke(line);
      break;
    case 'armor':
      g.ellipse(sx, sy, 6, 3.6).stroke(line);
      break;
    case 'artillery':
      g.circle(sx, sy, 2.4).fill({ color: 0xffffff });
      break;
    case 'air':
      g.poly([sx, sy - 5, sx + 7, sy + 4, sx, sy + 1.5, sx - 7, sy + 4]).fill({ color: 0xffffff });
      break;
    case 'naval':
      g.moveTo(sx, sy - 5).lineTo(sx, sy + 3).moveTo(sx - 4, sy - 2).lineTo(sx + 4, sy - 2).stroke(line);
      g.moveTo(sx + 5, sy + 1).arc(sx, sy + 1, 5, 0, Math.PI).stroke(line);
      break;
  }
}
