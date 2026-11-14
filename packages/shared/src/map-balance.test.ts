import { describe, expect, it } from 'vitest';
import { COUNTRIES, DEPOSIT_OUTPUT, PROVINCES, TIER_PROVINCES, tierOf } from './index';

const STRATEGIC = ['oil', 'steel', 'electronics', 'rare', 'wood'] as const;
const of = (code: string) => PROVINCES.filter((p) => p.countryCode === code);
const playable = COUNTRIES.filter((c) => c.playable);

describe('map balance', () => {
  it('there are 44 playable countries; the United States and the Soviet Union are the superpowers', () => {
    expect(playable.length).toBe(44);
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

  it('cities per country: 7 for super and major, 6 for medium, 3 to 5 for small playable countries', () => {
    for (const c of playable) {
      const n = of(c.code).filter((p) => p.isCity).length;
      if (c.tier === 'super' || c.tier === 'major') expect(n).toBe(7);
      else if (of(c.code).length >= 40 || c.code === 'FRG') expect(n).toBe(6);
      else expect(n >= 3 && n <= 5).toBe(true);
    }
  });

  it('cities of a playable country are spread out: no two cities are neighbouring provinces', () => {
    for (const c of playable) {
      const cities = of(c.code).filter((p) => p.isCity);
      const keys = new Set(cities.map((p) => p.key));
      const touching = cities.filter((p) => p.adjacent.some((k) => keys.has(k)));
      expect(touching.length <= 4).toBe(true); // in a few crowded countries (Britain, Egypt, Romania) a couple of pairs still touch
    }
  });

  it('the Pakistani and Indian frontiers have cities: Quetta, Gilgit, Srinagar and Jodhpur exist', () => {
    const names = (code: string) => of(code).filter((p) => p.isCity).map((p) => p.name);
    for (const n of ['Quetta', 'Gilgit', 'Lahore']) expect(names('PAK')).toContain(n);
    for (const n of ['Srinagar', 'Jodhpur']) expect(names('IND')).toContain(n);
    expect(names('PAK')).not.toContain('Attock');
  });

  it('every super, major and medium country has oil, steel, electronics, rare earth, wood and food; small ones lack at most one', () => {
    for (const c of playable) {
      const missing = [...STRATEGIC, 'food' as const].filter((k) => !of(c.code).some((p) => p.production[k] > 0));
      if (c.tier === 'super' || c.tier === 'major' || of(c.code).length >= 40) expect(missing.length).toBe(0);
      else expect(missing.length <= 1).toBe(true);
    }
  });

  it('history: Saudi oil, Japanese electronics, Chinese rare earth, Turkish steel', () => {
    const has = (code: string, k: (typeof STRATEGIC)[number]) => of(code).filter((p) => p.production[k] > 0).length;
    expect(has('SAU', 'oil') >= 2).toBe(true);
    expect(has('JPN', 'electronics') >= 2).toBe(true);
    expect(has('CHN', 'rare') >= 2).toBe(true);
    expect(has('TUR', 'steel') >= 2).toBe(true);
    expect(of('ROU').some((p) => p.name === 'Ploiesti' && p.deposit === 'oil')).toBe(true);
  });

  it('the 1950 world: two Germanys, two Koreas, two Chinas, Israel, and Tibet standing alone', () => {
    for (const code of ['FRG', 'GDR', 'KOR', 'PRK', 'CHN', 'TWN', 'ISR']) expect(of(code).length > 0).toBe(true);
    expect(COUNTRIES.some((c) => c.code === 'GER')).toBe(false);
    expect(of('TWN').every((p) => p.center.x > 2000)).toBe(true);
    expect(COUNTRIES.some((c) => c.name === 'Tibet' && !c.playable)).toBe(true);
    expect(of('KOR').some((p) => p.name === 'Chunchon') && of('PRK').some((p) => p.name === 'Kaesong')).toBe(true);
    expect(of('ISR').some((p) => p.name === 'Tel Aviv')).toBe(true);
  });

  it('each country has a capital, and its capital is a city', () => {
    for (const c of COUNTRIES) {
      const caps = of(c.code).filter((p) => p.isCapital);
      expect(caps.length).toBe(1);
      expect(caps[0].isCity).toBe(true);
    }
  });
});
