import { describe, expect, it } from 'vitest';
import { explainBattle, resolveBattle } from './index';
import type { BattleInput } from './index';

const inf = (count: number) => [{ unitType: 'infantry' as const, count }];

const base = (over: Partial<BattleInput> = {}): BattleInput => ({
  seed: 1,
  attackerUnits: inf(10),
  defenderUnits: inf(10),
  terrain: 'plains',
  fortress: false,
  provinceDefense: 0,
  ...over,
});

function winRate(over: Partial<BattleInput>, n = 400) {
  let wins = 0;
  for (let i = 0; i < n; i++) if (resolveBattle(base({ ...over, seed: i + 1 })).outcome === 'attacker_won') wins++;
  return wins / n;
}

describe('combat', () => {
  it('is deterministic for a seed', () => {
    expect(resolveBattle(base())).toEqual(resolveBattle(base()));
  });

  it('empty defenders lose without a fight', () => {
    const r = resolveBattle(base({ defenderUnits: [] }));
    expect(r.outcome).toBe('attacker_won');
    expect(r.rounds.length).toBe(0);
  });

  it('a much bigger army nearly always wins', () => {
    expect(winRate({ attackerUnits: inf(30) })).toBeGreaterThan(0.95);
  });

  it('terrain and fortress help the defender', () => {
    const open = winRate({});
    const dug = winRate({ terrain: 'mountains', fortress: true });
    expect(dug).toBeLessThan(open);
  });

  it('the winner keeps units and the report explains why', () => {
    const r = resolveBattle(base({ attackerUnits: inf(20), terrain: 'hills' }));
    expect(explainBattle(r).length).toBeGreaterThan(1);
    if (r.outcome === 'attacker_won') expect(r.defenderAfter).toEqual([]);
    else expect(r.attackerAfter).toEqual([]);
  });
});
