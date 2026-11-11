import type { Graphics } from 'pixi.js';
import type { ProvinceGeo, ResourceKey } from '@cw/shared';

export interface ResourceIconSpec {
  kind: ResourceKey;
  /** A hot spot: the province produces this resource at double rate. */
  doubled: boolean;
}

/** A city shows the icon of its resource; a deposit province gets a gold ring and x2. */
export function resourceIconsFor(geo: ProvinceGeo): ResourceIconSpec[] {
  return geo.deposit ? [{ kind: geo.deposit, doubled: geo.doubled }] : [];
}

/** Simple vector icons, about 12 map units tall, centred on (x, 0). No image files needed. */
export function drawResourceIcon(g: Graphics, kind: ResourceKey, x: number, doubled: boolean): void {
  switch (kind) {
    case 'oil':
      g.poly([x - 3.8, 0.5, x, -7, x + 3.8, 0.5]).fill(0x20252b);
      g.circle(x, 2, 4.4).fill(0x20252b);
      g.circle(x - 1.5, 1.2, 1.1).fill(0x8aa0b4);
      g.poly([x - 3.8, 0.5, x, -7, x + 3.8, 0.5]).stroke({ width: 0.8, color: 0xc8d2dc });
      g.circle(x, 2, 4.4).stroke({ width: 0.8, color: 0xc8d2dc });
      break;
    case 'steel':
      g.poly([x - 6, 3.5, x - 4, -3.5, x + 4, -3.5, x + 6, 3.5]).fill(0xaab4c0).stroke({ width: 0.8, color: 0x56616d });
      g.poly([x - 4, -3.5, x + 4, -3.5, x + 3, -1, x - 3, -1]).fill(0xdde4ec);
      break;
    case 'electronics':
      // a green microchip
      g.roundRect(x - 4.5, -4.5, 9, 9, 1.5).fill(0x3ddc84).stroke({ width: 0.8, color: 0x0f5a32 });
      g.roundRect(x - 2, -2, 4, 4, 0.6).fill(0x0f5a32);
      for (const d of [-3, 0, 3]) {
        g.poly([x + d, -4.5, x + d, -6.5]).stroke({ width: 0.9, color: 0xbfe9d0 });
        g.poly([x + d, 4.5, x + d, 6.5]).stroke({ width: 0.9, color: 0xbfe9d0 });
      }
      break;
    case 'rare':
      // orange crystal: rare earth
      g.poly([x, -6.5, x + 5, -1, x, 6.5, x - 5, -1]).fill(0xff8a1f).stroke({ width: 0.8, color: 0xffe0b8 });
      g.poly([x - 5, -1, x, -6.5, x + 5, -1, x, 0]).fill(0xffc277);
      break;
    case 'wood':
      g.roundRect(x - 5.5, -2.5, 11, 5, 2.5).fill(0xb5783a).stroke({ width: 0.8, color: 0x5a3716 });
      g.roundRect(x - 5.5, 3, 11, 4, 2).fill(0xa06a32).stroke({ width: 0.8, color: 0x5a3716 });
      g.roundRect(x - 4.5, -7, 9, 4, 2).fill(0xc88a4a).stroke({ width: 0.8, color: 0x5a3716 });
      g.circle(x + 3.2, 0, 1).fill(0x5a3716);
      break;
    case 'money':
      g.circle(x, 0, 5).fill(0xf2c14e).stroke({ width: 0.8, color: 0x8a6a10 });
      g.circle(x, 0, 2.6).stroke({ width: 0.8, color: 0x8a6a10 });
      break;
    case 'food':
      g.poly([x, -6, x + 4, -1, x, 6, x - 4, -1]).fill(0x7cc45c).stroke({ width: 0.8, color: 0x2f6b1c });
      g.poly([x, -5, x, 5]).stroke({ width: 0.8, color: 0x2f6b1c });
      break;
    case 'manpower':
      g.circle(x, -3.5, 2.6).fill(0x6fa8ff);
      g.poly([x - 4.5, 6, x - 3.5, 0, x + 3.5, 0, x + 4.5, 6]).fill(0x6fa8ff);
      break;
  }
  if (doubled) g.circle(x, 0, 8).stroke({ width: 1.4, color: 0xffe27a });
}
