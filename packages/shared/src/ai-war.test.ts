import { describe, expect, it } from 'vitest';
import { AI_ATTACK_RATIO, PROVINCES, PROVINCE_BY_KEY, airModifiers, canOccupyLand, isNavalFormation, planAiWar, planRoute, unitPower } from './index';

// Find an AI home province F and a neighbouring province T of another country.
const pair = (() => {
  for (const f of PROVINCES) {
    for (const t of f.adjacent) {
      const g = PROVINCE_BY_KEY[t];
      if (g.countryCode !== f.countryCode) return { f, t: g };
    }
  }
  throw new Error('no border');
})();
const AI = 'ai';
const FOE = 'foe';
const inf = (n: number) => [{ unitType: 'infantry' as const, count: n }];
const base = (over: Record<string, unknown> = {}) => ({
  countryId: AI,
  countryCode: pair.f.countryCode,
  ownerByKey: new Map<string, string>([[pair.f.key, AI], [pair.t.key, FOE]]),
  enemies: new Set([FOE]),
  ownUnits: new Map([[pair.f.key, inf(12)]]),
  enemyPower: new Map<string, number>([[pair.t.key, unitPower(inf(3))]]),
  threat: new Map<string, number>(),
  ...over,
});

describe('AI warfare', () => {
  it('counterattacks an adjacent province it is clearly stronger than', () => {
    const plan = planAiWar(base());
    expect(plan.attacks.length).toBe(1);
    expect(plan.attacks[0].toKey).toBe(pair.t.key);
    expect(unitPower(plan.attacks[0].send)).toBeGreaterThan(AI_ATTACK_RATIO * unitPower(inf(3)));
  });

  it('does not attack a stronger province', () => {
    const plan = planAiWar(base({ enemyPower: new Map([[pair.t.key, unitPower(inf(40))]]) }));
    expect(plan.attacks.length).toBe(0);
  });

  it('walks into an undefended province', () => {
    const plan = planAiWar(base({ enemyPower: new Map(), ownUnits: new Map([[pair.f.key, inf(4)]]) }));
    expect(plan.attacks.length).toBe(1);
  });

  it('does nothing when at peace', () => {
    const plan = planAiWar(base({ enemies: new Set() }));
    expect(plan.attacks.length).toBe(0);
    expect(plan.recruit.length).toBe(0);
  });

  it('recruits infantry where the threat is bigger than the defence, within limits', () => {
    const plan = planAiWar(base({ ownUnits: new Map([[pair.f.key, inf(2)]]), threat: new Map([[pair.f.key, unitPower(inf(20))]]), enemyPower: new Map([[pair.t.key, unitPower(inf(40))]]) }));
    expect(plan.recruit.length).toBe(1);
    expect(plan.recruit[0].infantry).toBeGreaterThan(0);
    expect(plan.recruit[0].infantry).toBeLessThan(5);
    expect(plan.attacks.length).toBe(0);
  });

  it('masses troops next to a lost home province before attacking it', () => {
    const home = PROVINCES.find((p) => p.adjacent.some((a) => PROVINCE_BY_KEY[a].countryCode !== p.countryCode))!;
    const lost = home.adjacent.map((a) => PROVINCE_BY_KEY[a]).find((g) => g.countryCode === home.countryCode);
    if (!lost) return; // map shape has no such pair; the rule is covered above
    const plan = planAiWar({
      countryId: AI,
      countryCode: home.countryCode,
      ownerByKey: new Map([[home.key, AI], [lost.key, FOE]]),
      enemies: new Set([FOE]),
      ownUnits: new Map([[home.key, inf(2)]]),
      enemyPower: new Map([[lost.key, unitPower(inf(5))]]),
      threat: new Map(),
    });
    expect(plan.attacks.length).toBe(0);
    expect(plan.recruit.length).toBe(1);
  });

  it('keeps troops at home when threatened instead of attacking', () => {
    const plan = planAiWar(base({ threat: new Map([[pair.f.key, unitPower(inf(12))]]) }));
    expect(plan.attacks.length).toBe(0);
  });
});

describe('air and navy rules', () => {
  it('fighters give air superiority only when there are more of them', () => {
    const a = [{ unitType: 'fighter' as const, count: 3 }, ...inf(5)];
    const b = [{ unitType: 'fighter' as const, count: 1 }, ...inf(5)];
    expect(airModifiers('attacker', a, b).length).toBe(1);
    expect(airModifiers('defender', b, a).length).toBe(0);
  });

  it('ships stay on the coast and cannot take land alone', () => {
    const fleet = [{ unitType: 'destroyer' as const, count: 2 }];
    expect(isNavalFormation(fleet)).toBe(true);
    expect(canOccupyLand(fleet)).toBe(false);
    expect(canOccupyLand(inf(1))).toBe(true);
    const coastal = PROVINCES.filter((p) => p.isCoastal);
    const from = coastal[0].key;
    const to = coastal.find((p) => p.key !== from && coastal[0].adjacent.includes(p.key))?.key;
    if (to) {
      const own = new Map(PROVINCES.map((p) => [p.key, 'me']));
      const route = planRoute(from, to, { countryId: 'me', ownerByKey: own, atWarWith: new Set(), railwayKeys: new Set(), speed: 1, gameSpeed: 1, coastalOnly: true });
      expect(route !== null).toBe(true);
    }
    const inland = PROVINCES.find((p) => !p.isCoastal)!;
    const own = new Map(PROVINCES.map((p) => [p.key, 'me']));
    const none = planRoute(from, inland.key, { countryId: 'me', ownerByKey: own, atWarWith: new Set(), railwayKeys: new Set(), speed: 1, gameSpeed: 1, coastalOnly: true });
    expect(none).toBeNull();
  });
});
