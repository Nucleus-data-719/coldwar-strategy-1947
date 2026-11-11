import { describe, expect, it } from 'vitest';
import { PROVINCES, advanceMovement, formationSpeed, legSeconds, planRoute } from './index';

const ME = 'me';
const THEM = 'them';

function ownership(codeToOwner: Record<string, string>) {
  return new Map(PROVINCES.map((p) => [p.key, codeToOwner[p.countryCode] ?? THEM]));
}
const usa = ownership({ USA: ME });
const baseCtx = { countryId: ME, ownerByKey: usa, atWarWith: new Set<string>(), railwayKeys: new Set<string>(), speed: 1, gameSpeed: 1 };

describe('movement', () => {
  it('speed is the slowest unit, 0 when empty', () => {
    expect(formationSpeed([{ unitType: 'infantry', count: 5 }])).toBe(1);
    expect(
      formationSpeed([
        { unitType: 'infantry', count: 5 },
        { unitType: 'artillery', count: 2 },
      ]),
    ).toBeLessThan(1);
    expect(formationSpeed([])).toBe(0);
  });

  it('routes through own provinces only', () => {
    const route = planRoute('washington', 'st_louis', baseCtx)!;
    expect(route.path[0]).toBe('washington');
    expect(route.path.at(-1)).toBe('st_louis');
    expect(route.path.length).toBeGreaterThan(2);
    expect(route.legSeconds.length).toBe(route.path.length - 1);
    for (const key of route.path) expect(usa.get(key)).toBe(ME);
  });

  it('refuses enemy destinations', () => {
    expect(planRoute('washington', 'mexico_city', baseCtx)).toBeNull();
  });

  it('railways halve a leg and faster units arrive sooner', () => {
    const slow = planRoute('washington', 'st_louis', baseCtx)!;
    const fast = planRoute('washington', 'st_louis', { ...baseCtx, speed: 2 })!;
    const rail = planRoute('washington', 'st_louis', { ...baseCtx, railwayKeys: new Set(slow.path) })!;
    expect(fast.totalSeconds).toBeLessThan(slow.totalSeconds * 0.6);
    expect(rail.totalSeconds).toBeLessThan(slow.totalSeconds * 0.6);
  });

  it('game speed shortens travel', () => {
    expect(legSeconds('washington', 'pittsburgh', 1, false, 60)).toBeLessThan(legSeconds('washington', 'pittsburgh', 1, false, 1) / 50);
  });

  it('applies several finished legs after being offline, without drifting', () => {
    const route = planRoute('washington', 'st_louis', baseCtx)!;
    const start = 1_000_000;
    const firstArrive = start + route.legSeconds[0] * 1000;
    const input = {
      locationKey: route.path[0],
      nextKey: route.path[1],
      remainingKeys: route.path.slice(2),
      legArrivesAt: firstArrive,
      speed: 1,
      gameSpeed: 1,
      countryId: ME,
      ownerByKey: usa, atWarWith: new Set<string>(),
      railwayKeys: new Set<string>(),
    };
    // Server comes back long after the whole journey.
    expect(advanceMovement({ ...input, now: start + 10 * 3600 * 1000 })).toEqual({
      status: 'arrived',
      locationKey: route.path.at(-1),
    });
    // Server comes back between leg 2 and leg 3: the next leg starts exactly when leg 2 ended.
    const afterLeg2 = start + (route.legSeconds[0] + route.legSeconds[1]) * 1000;
    const mid = advanceMovement({ ...input, now: afterLeg2 - 1000 });
    expect(mid.status).toBe('moving');
    if (mid.status === 'moving') {
      expect(mid.locationKey).toBe(route.path[1]);
      expect(mid.nextKey).toBe(route.path[2]);
      expect(mid.legStartedAt).toBe(firstArrive);
      expect(mid.legArrivesAt).toBe(afterLeg2);
    }
  });

  it('stops when the next province is no longer ours', () => {
    const route = planRoute('washington', 'st_louis', baseCtx)!;
    const lost = new Map(usa);
    lost.set(route.path[2], THEM);
    const result = advanceMovement({
      locationKey: route.path[0],
      nextKey: route.path[1],
      remainingKeys: route.path.slice(2),
      legArrivesAt: 0,
      now: 1e12,
      speed: 1,
      gameSpeed: 1,
      countryId: ME,
      ownerByKey: lost, atWarWith: new Set<string>(),
      railwayKeys: new Set<string>(),
    });
    expect(result).toEqual({ status: 'blocked', locationKey: route.path[1] });
  });

  it('plans through enemy land only when at war', () => {
    const goal = PROVINCES.find((p) => p.countryCode !== 'USA')!.key;
    const enemyId = usa.get(goal)!;
    expect(planRoute('washington', goal, baseCtx)).toBeNull();
    const route = planRoute('washington', goal, { ...baseCtx, atWarWith: new Set([enemyId]) });
    expect(route !== null).toBe(true);
  });

  it('stops with a battle when the next province is hostile', () => {
    const goal = PROVINCES.find((p) => p.countryCode !== 'USA')!.key;
    const enemyId = usa.get(goal)!;
    const war = { ...baseCtx, atWarWith: new Set([enemyId]) };
    const route = planRoute('washington', goal, war)!;
    const firstEnemy = route.path.findIndex((k) => usa.get(k) === enemyId);
    expect(firstEnemy).toBeGreaterThan(0);
    const result = advanceMovement({
      locationKey: route.path[firstEnemy - 2] ?? route.path[0],
      nextKey: route.path[firstEnemy - 1],
      remainingKeys: route.path.slice(firstEnemy),
      legArrivesAt: 0,
      now: 1e12,
      speed: 1,
      gameSpeed: 1,
      countryId: ME,
      ownerByKey: usa,
      atWarWith: war.atWarWith,
      railwayKeys: new Set<string>(),
    });
    expect(result.status).toBe('battle');
    if (result.status === 'battle') expect(result.targetKey).toBe(route.path[firstEnemy]);
  });
});
