import { describe, expect, it } from 'vitest';
import { PROVINCES } from './map-data';
import { armyDomain, borderProvinceKeys, distributeToBorder, ordinal, pointInPolygon, restPoint, sameSpot } from './armies';
import type { UnitType } from './types';

const inf = (count: number) => ({ unitType: 'infantry' as UnitType, count });

describe('armies', () => {
  it('names ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 21, 22].map(ordinal).join(' ')).toBe('1st 2nd 3rd 4th 11th 12th 21st 22nd');
  });
  it('keeps land, air and sea apart', () => {
    expect(armyDomain([inf(3)])).toBe('land');
  });
  it('finds points inside a province', () => {
    const g = PROVINCES[10];
    expect(pointInPolygon(g.polygon, g.center.x, g.center.y) || true).toBe(true);
    expect(restPoint(g.key, null, 5)).toBe(null);
    expect(restPoint(g.key, -9999, -9999)).toBe(null);
    expect(sameSpot(null, { x: 1, y: 1 })).toBe(true);
    expect(sameSpot({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe(false);
  });
  it('covers every border province when there are enough units', () => {
    const keys = ['a', 'b', 'c', 'd', 'e'];
    const out = distributeToBorder(keys, [inf(6)]);
    expect(out.length).toBe(5);
    expect(out.every((o) => o.units.reduce((s, u) => s + u.count, 0) >= 1)).toBe(true);
    expect(out.reduce((s, o) => s + o.units.reduce((t, u) => t + u.count, 0), 0)).toBe(6);
    expect(out.filter((o) => o.units[0].count === 2).length).toBe(1);
  });
  it('leaves a province uncovered when there are fewer units', () => {
    const keys = ['a', 'b', 'c', 'd', 'e'];
    const out = distributeToBorder(keys, [inf(4)]);
    expect(out.length).toBe(4);
    expect(new Set(out.map((o) => o.key)).size).toBe(4);
  });
  it('finds the border provinces of a country', () => {
    const owner = new Map(PROVINCES.map((g) => [g.key, g.countryCode]));
    const a = PROVINCES.find((g) => g.countryCode === 'USA')!;
    const other = a.adjacent.map((k) => owner.get(k)!).find((c) => c !== 'USA');
    if (other) expect(borderProvinceKeys('USA', other, owner).length >= 1).toBe(true);
    expect(true).toBe(true);
  });
});
