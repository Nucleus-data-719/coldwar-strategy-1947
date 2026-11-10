import { describe, expect, it } from 'vitest';
import { TECHS, TECH_BY_ID, researchSeconds, summariseResearch } from './index';

describe('research', () => {
  it('ids are unique and prerequisites exist and come from a lower tier', () => {
    expect(new Set(TECHS.map((t) => t.id)).size).toBe(TECHS.length);
    for (const t of TECHS) {
      for (const r of t.requires) {
        expect(TECH_BY_ID[r] !== undefined).toBe(true);
        expect(TECH_BY_ID[r].tier).toBeLessThan(t.tier);
      }
    }
  });

  it('every branch has five techs, one per tier', () => {
    for (const b of ['infantry', 'armor', 'air', 'naval', 'industry']) {
      const tiers = TECHS.filter((t) => t.branch === b).map((t) => t.tier).sort();
      expect(tiers.join(',')).toBe('1,2,3,4,5');
    }
  });

  it('light tanks unlock only after researching them', () => {
    expect(summariseResearch([], 0, 0).unlockedUnits.includes('light_tank')).toBe(false);
    expect(summariseResearch(['armor_1'], 0, 0).unlockedUnits.includes('light_tank')).toBe(true);
    expect(summariseResearch([], 0, 0).unlockedUnits.includes('artillery')).toBe(true);
  });

  it('a university shortens the next project', () => {
    const base = summariseResearch([], 0, 0).speedPercent;
    const withUni = summariseResearch([], 0, 1).speedPercent;
    const t = TECH_BY_ID['armor_1'];
    expect(researchSeconds(t.baseSeconds, withUni, 1)).toBeLessThan(researchSeconds(t.baseSeconds, base, 1));
    expect(researchSeconds(t.baseSeconds, 25, 1)).toBe(Math.round(t.baseSeconds / 1.25));
  });

  it('speed is capped at +100% however many labs and universities you have', () => {
    const s = summariseResearch(['ind_4'], 10, 10);
    expect(s.speedPercent).toBe(100);
    expect(s.rawSpeedPercent).toBeGreaterThan(100);
  });

  it('bonuses add up', () => {
    const s = summariseResearch(['inf_1', 'inf_2', 'ind_1', 'ind_2'], 0, 0);
    expect(s.combatPercent).toBe(8);
    expect(s.productionPercent).toBe(10);
  });
});
