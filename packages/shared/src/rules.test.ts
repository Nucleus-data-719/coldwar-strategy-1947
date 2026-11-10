import { describe, expect, it } from 'vitest';
import {
  applyRates,
  canAfford,
  emptyResources,
  provinceProduction,
  scaleSeconds,
  unitUpkeepPerHour,
  PROVINCES,
  shortagesOf,
  supplyPenalty,
  COUNTRIES,
} from './index';

describe('rules', () => {
  it('local factory adds 25% production once complete', () => {
    const base = { ...emptyResources(), money: 100 };
    expect(provinceProduction(base, [{ type: 'local_factory', status: 'constructing' }]).money).toBe(100);
    expect(provinceProduction(base, [{ type: 'local_factory', status: 'complete' }]).money).toBe(125);
  });

  it('applyRates never goes below zero', () => {
    const bal = { ...emptyResources(), food: 10 };
    const rates = { ...emptyResources(), food: -100 };
    expect(applyRates(bal, rates, 3600).food).toBe(0);
  });

  it('canAfford checks every resource', () => {
    const bal = { ...emptyResources(), money: 100, steel: 5 };
    expect(canAfford(bal, { money: 50 })).toBe(true);
    expect(canAfford(bal, { money: 50, steel: 10 })).toBe(false);
  });

  it('upkeep scales with unit count', () => {
    const up = unitUpkeepPerHour([{ unitType: 'infantry', count: 10 }]);
    expect(up.food).toBe(10);
    expect(up.money).toBe(5);
  });

  it('scaleSeconds divides by game speed', () => {
    expect(scaleSeconds(3600, 60)).toBe(60);
    expect(scaleSeconds(10, 100)).toBe(1);
  });
});

describe('map data', () => {
  it('has 150-250 provinces, each country owns some, and one capital per country', () => {
    expect(PROVINCES.length).toBeGreaterThan(149);
    expect(PROVINCES.length).toBeLessThan(251);
    for (const c of COUNTRIES) {
      const owned = PROVINCES.filter((p) => p.countryCode === c.code);
      expect(owned.length).toBeGreaterThan(0);
      expect(owned.filter((p) => p.isCapital).length).toBe(1);
    }
  });

  it('every capital name matches its country and every province has a neighbour', () => {
    for (const c of COUNTRIES) {
      const cap = PROVINCES.find((p) => p.countryCode === c.code && p.isCapital)!;
      expect(cap.name).toBe(c.capitalName);
    }
    for (const p of PROVINCES) expect(p.adjacent.length).toBeGreaterThan(0);
    for (const p of PROVINCES) expect(p.polygon.length).toBeGreaterThan(5);
  });

  it('the whole map is one connected world', () => {
    const seen = new Set<string>([PROVINCES[0].key]);
    const stack = [PROVINCES[0].key];
    const byKey = new Map(PROVINCES.map((p) => [p.key, p]));
    while (stack.length) {
      for (const n of byKey.get(stack.pop()!)!.adjacent) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    expect(seen.size).toBe(PROVINCES.length);
  });

  it('adjacency is symmetric', () => {
    const byKey = new Map(PROVINCES.map((p) => [p.key, p]));
    for (const p of PROVINCES) {
      for (const a of p.adjacent) expect(byKey.get(a)!.adjacent).toContain(p.key);
    }
  });
});

describe('supply', () => {
  it('shortage needs an empty stockpile and a negative rate', () => {
    const balance = { ...emptyResources(), oil: 0, food: 0 };
    const rates = { ...emptyResources(), oil: -1, food: 2 };
    expect(shortagesOf(balance, rates).join(',')).toBe('oil');
    expect(supplyPenalty(['oil'])[0].percent).toBe(-20);
  });
});
