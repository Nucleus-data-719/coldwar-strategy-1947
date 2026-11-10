import type { Graphics } from 'pixi.js';
import type { ProvinceGeo, ResourceKey } from '@cw/shared';

export interface ResourceIconSpec {
  kind: ResourceKey;
  /** A hot spot: the province produces this resource at double rate. */
  doubled: boolean;
}

/** A province with a deposit gets one icon; a doubled region also gets a gold ring and x2. */
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
      g.poly([x + 1.5, -7, x - 4, 1, x - 0.5, 1, x - 1.5, 7, x + 4, -1.5, x + 0.5, -1.5])
        .fill(0xffd54a)
        .stroke({ width: 0.8, color: 0x7a5d00 });
      break;
    case 'rare':
      g.poly([x, -6.5, x + 5, -1, x, 6.5, x - 5, -1]).fill(0xb36bff).stroke({ width: 0.8, color: 0xf0d9ff });
      g.poly([x - 5, -1, x, -6.5, x + 5, -1, x, 0]).fill(0xd8b4ff);
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
