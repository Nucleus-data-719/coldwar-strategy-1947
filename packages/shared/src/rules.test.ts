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
    // Food and manpower are not industrial.
    const mixed = { ...base, food: 100, manpower: 100, oil: 20 };
    const built = provinceProduction(mixed, [{ type: 'local_factory', status: 'complete' }]);
    expect(built.food).toBe(100);
    expect(built.manpower).toBe(100);
    expect(built.oil).toBe(25);
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
  it('has 2000 to 3000 provinces, each country owns some, and one capital per country', () => {
    expect(PROVINCES.length).toBeGreaterThan(1999);
    expect(PROVINCES.length).toBeLessThan(3001);
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

  it('land and ferries join the map into a few big landmasses, and almost every province is on a big one', () => {
    const byKey = new Map(PROVINCES.map((p) => [p.key, p]));
    const seen = new Set<string>();
    const groups: number[] = [];
    for (const p of PROVINCES) {
      if (seen.has(p.key)) continue;
      let n = 0; const stack = [p.key]; seen.add(p.key);
      while (stack.length) { const k = stack.pop()!; n++; for (const a of byKey.get(k)!.adjacent) if (!seen.has(a)) { seen.add(a); stack.push(a); } }
      groups.push(n);
    }
    groups.sort((a, b) => b - a);
    expect(groups[0] > PROVINCES.length * 0.4).toBe(true); // Eurasia and Africa
    expect(groups.length < 15).toBe(true);
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
