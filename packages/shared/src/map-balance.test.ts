import { describe, expect, it } from 'vitest';
import { COUNTRIES, DEPOSIT_OUTPUT, PROVINCES, TIER_PROVINCES, tierOf } from './index';

const STRATEGIC = ['oil', 'steel', 'electronics', 'rare'] as const;
const of = (code: string) => PROVINCES.filter((p) => p.countryCode === code);
const strategicTotal = (code: string) => {
  const t = { oil: 0, steel: 0, electronics: 0, rare: 0 };
  for (const p of of(code)) for (const k of STRATEGIC) t[k] += p.production[k];
  return JSON.stringify(t);
};

describe('map balance', () => {
  it('big countries have 10 provinces, medium 8, AI-run minor countries 4 or fewer', () => {
    for (const c of COUNTRIES) {
      const n = of(c.code).length;
      const tier = tierOf(c.code);
      if (tier === 'minor') {
        expect(n).toBeLessThan(TIER_PROVINCES.minor + 1);
        expect(n).toBeGreaterThan(0);
        expect(c.playable).toBe(false);
      } else {
        expect(n).toBe(TIER_PROVINCES[tier]);
        expect(c.playable).toBe(true);
      }
    }
  });

  it('every country has one or two double-resource provinces', () => {
    for (const c of COUNTRIES) {
      const doubled = of(c.code).filter((p) => p.doubled).length;
      expect(doubled).toBeGreaterThan(0);
      expect(doubled).toBeLessThan(3);
    }
  });

  it('only deposits produce strategic resources, and doubled regions produce twice as much', () => {
    for (const p of PROVINCES) {
      for (const k of STRATEGIC) {
        const expected = p.deposit === k ? DEPOSIT_OUTPUT[k] * (p.doubled ? 2 : 1) : 0;
        expect(p.production[k]).toBe(expected);
      }
      if (p.doubled) expect(p.deposit !== undefined).toBe(true);
    }
  });

  it('every province produces money, food and manpower', () => {
    for (const p of PROVINCES) {
      expect(p.production.money).toBeGreaterThan(0);
      expect(p.production.food).toBeGreaterThan(0);
      expect(p.production.manpower).toBeGreaterThan(0);
    }
  });

  it('countries of the same size have identical strategic output, and every player country has all four', () => {
    const big = COUNTRIES.filter((c) => tierOf(c.code) === 'big').map((c) => strategicTotal(c.code));
    const medium = COUNTRIES.filter((c) => tierOf(c.code) === 'medium').map((c) => strategicTotal(c.code));
    for (const t of big) expect(t).toBe(big[0]);
    for (const t of medium) expect(t).toBe(medium[0]);
    for (const c of COUNTRIES.filter((c) => c.playable)) {
      for (const k of STRATEGIC) expect(of(c.code).some((p) => p.production[k] > 0)).toBe(true);
    }
  });
});
