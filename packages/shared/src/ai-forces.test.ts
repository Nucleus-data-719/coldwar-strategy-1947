import { describe, it, expect } from 'vitest';
import { PROVINCES, aiPurchases, aiPatrolWorthKeeping, planAiFleetTarget, planAiPatrol, unitPower, aiAircraftCap } from './index';

const a = PROVINCES[0];
const near = a.adjacent[0];
const inf = (n: number) => [{ unitType: 'infantry' as const, count: n }];

describe('AI air and sea', () => {
  it('patrols over the province with the biggest enemy army in reach', () => {
    const r = planAiPatrol({
      baseKey: a.key,
      units: [{ unitType: 'bomber', count: 3 }],
      enemyPower: new Map([[near, unitPower(inf(20))]]),
      enemyProvinces: new Set([near]),
    });
    expect(r !== null).toBe(true);
  });
  it('does not fly for a token force', () => {
    const r = planAiPatrol({ baseKey: a.key, units: [{ unitType: 'bomber', count: 3 }], enemyPower: new Map([[near, unitPower(inf(1))]]), enemyProvinces: new Set([near]) });
    expect(r).toBe(null);
  });
  it('calls off a patrol once the enemy is gone', () => {
    expect(aiPatrolWorthKeeping(near, [{ unitType: 'fighter', count: 2 }], new Map())).toBe(false);
  });
  it('only hunts fleets it clearly outguns', () => {
    const mine = [{ unitType: 'destroyer' as const, count: 4 }];
    expect(planAiFleetTarget(mine, [{ id: 'weak', units: [{ unitType: 'corvette', count: 1 }], distance: 3 }])).toBe('weak');
    expect(planAiFleetTarget(mine, [{ id: 'strong', units: [{ unitType: 'battleship', count: 2 }], distance: 1 }])).toBe(null);
  });
  it('buys a few aircraft and ships only at war and within the cap', () => {
    expect(aiPurchases({ atWar: false, ownedProvinces: 8, hasAirbase: true, hasHarbor: true, aircraft: 0, ships: 0 }).length).toBe(0);
    expect(aiPurchases({ atWar: true, ownedProvinces: 8, hasAirbase: true, hasHarbor: true, aircraft: 0, ships: 0 }).length).toBe(2);
    expect(aiPurchases({ atWar: true, ownedProvinces: 8, hasAirbase: true, hasHarbor: false, aircraft: aiAircraftCap(8), ships: 0 }).length).toBe(0);
  });
});
