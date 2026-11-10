import { describe, expect, it } from 'vitest';
import {
  GENERALS,
  GENERAL_BY_ID,
  GENERAL_CATEGORIES,
  STARTER_GENERALS,
  generalLevel,
  generalModifiers,
  generalPassivePercent,
  resolveBattle,
  xpToNextLevel,
} from './index';

describe('generals', () => {
  it('roster has three per category, unique ids, starters exist', () => {
    expect(new Set(GENERALS.map((g) => g.id)).size).toBe(GENERALS.length);
    for (const c of GENERAL_CATEGORIES) expect(GENERALS.filter((g) => g.category === c.id).length).toBe(3);
    for (const id of STARTER_GENERALS) expect(GENERAL_BY_ID[id] !== undefined).toBe(true);
  });

  it('levels rise with experience and stop at 5', () => {
    expect(generalLevel(0)).toBe(1);
    expect(generalLevel(100)).toBe(2);
    expect(generalLevel(99999)).toBe(5);
    expect(xpToNextLevel(0)).toBe(100);
    expect(xpToNextLevel(5000)).toBeNull();
  });

  it('passive bonus grows with level', () => {
    const g = GENERAL_BY_ID.ridgway;
    expect(generalPassivePercent(g, 3)).toBeGreaterThan(generalPassivePercent(g, 1));
  });

  it('a general only helps when his kind of unit is present, and the ability only while active', () => {
    const inf = [{ unitType: 'infantry' as const, count: 5 }];
    expect(generalModifiers('attacker', [{ generalId: 'abrams', xp: 0, abilityActiveUntil: null, units: inf }], 0).length).toBe(0);
    const base = generalModifiers('attacker', [{ generalId: 'ridgway', xp: 0, abilityActiveUntil: null, units: inf }], 1000);
    expect(base.length).toBe(1);
    const withAbility = generalModifiers('attacker', [{ generalId: 'ridgway', xp: 0, abilityActiveUntil: 5000, units: inf }], 1000);
    expect(withAbility.length).toBe(2);
    const expired = generalModifiers('attacker', [{ generalId: 'ridgway', xp: 0, abilityActiveUntil: 500, units: inf }], 1000);
    expect(expired.length).toBe(1);
  });

  it('a general measurably improves a battle', () => {
    const units = [{ unitType: 'infantry' as const, count: 10 }];
    const input = { seed: 7, attackerUnits: units, defenderUnits: units, terrain: 'plains' as const, fortress: false, provinceDefense: 0 };
    const plain = resolveBattle(input);
    const led = resolveBattle({
      ...input,
      attackerModifiers: generalModifiers('attacker', [{ generalId: 'giap', xp: 1000, abilityActiveUntil: 9e9, units }], 0),
    });
    const left = (r: typeof plain) => r.attackerAfter.reduce((s, u) => s + u.count, 0) - r.defenderAfter.reduce((s, u) => s + u.count, 0);
    expect(left(led)).toBeGreaterThan(left(plain));
  });
});
