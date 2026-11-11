import { describe, expect, it } from 'vitest';
import { COUNTRIES, DEPOSIT_OUTPUT, PROVINCES, TIER_PROVINCES, tierOf } from './index';

const STRATEGIC = ['oil', 'steel', 'electronics', 'rare', 'wood'] as const;
const of = (code: string) => PROVINCES.filter((p) => p.countryCode === code);
const playable = COUNTRIES.filter((c) => c.playable);

describe('map balance', () => {
  it('there are 40 playable countries; the United States and the Soviet Union are the superpowers', () => {
    expect(playable.length).toBe(40);
    expect(tierOf('USA')).toBe('super');
    expect(tierOf('SOV')).toBe('super');
    expect(playable.filter((c) => tierOf(c.code) === 'super').length).toBe(2);
  });

  it('province counts follow the size of the country', () => {
    for (const c of COUNTRIES) {
      const n = of(c.code).length;
      const [lo, hi] = TIER_PROVINCES[tierOf(c.code)];
      expect(n >= lo - 2 && n <= hi + 3).toBe(true); // a landmass floor can add a province or two
      expect(n > 0).toBe(true);
      if (!c.playable) expect(tierOf(c.code)).toBe('minor');
    }
  });

  it('every major and medium country has exactly two deposit provinces, and a deposit is never a city', () => {
    for (const c of playable) {
      const dep = of(c.code).filter((p) => p.doubled);
      expect(dep.length).toBe(2);
      for (const p of dep) { expect(p.isCity).toBe(false); expect(p.deposit !== undefined).toBe(true); }
    }
  });

  it('cities produce manpower, money and one resource; other provinces produce manpower and money only', () => {
    for (const p of PROVINCES) {
      expect(p.production.money > 0).toBe(true);
      expect(p.production.manpower > 0).toBe(true);
      const res = (['food', ...STRATEGIC] as const).filter((k) => p.production[k] > 0);
      if (p.isCity) {
        expect(res.length).toBe(1);
        expect(res[0]).toBe(p.deposit);
        expect(p.production[p.deposit!]).toBe(DEPOSIT_OUTPUT[p.deposit!]);
      } else if (p.doubled) {
        expect(res.length).toBe(1);
        expect(p.production[p.deposit!]).toBe(DEPOSIT_OUTPUT[p.deposit!] * 2);
      } else {
        expect(res.length).toBe(0);
        expect(p.deposit === undefined).toBe(true);
      }
    }
  });

  it('every playable country has oil, steel, electronics, rare earth, wood and food', () => {
    for (const c of playable) {
      for (const k of [...STRATEGIC, 'food'] as const) {
        expect(of(c.code).some((p) => p.production[k] > 0)).toBe(true);
      }
    }
  });

  it('history: Saudi oil, Japanese electronics, Chinese rare earth, Turkish steel', () => {
    const has = (code: string, k: (typeof STRATEGIC)[number]) => of(code).filter((p) => p.production[k] > 0).length;
    expect(has('SAU', 'oil') >= 3).toBe(true);
    expect(has('JPN', 'electronics') >= 4).toBe(true);
    expect(has('CHN', 'rare') >= 3).toBe(true);
    expect(has('TUR', 'steel') >= 3).toBe(true);
    expect(of('ROU').some((p) => p.name === 'Ploiesti' && p.deposit === 'oil')).toBe(true);
  });

  it('each country has a capital, and its capital is a city', () => {
    for (const c of COUNTRIES) {
      const caps = of(c.code).filter((p) => p.isCapital);
      expect(caps.length).toBe(1);
      expect(caps[0].isCity).toBe(true);
    }
  });
});
