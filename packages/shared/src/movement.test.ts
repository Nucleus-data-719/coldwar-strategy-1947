import { describe, expect, it } from 'vitest';
import { PROVINCES, advanceMovement, formationSpeed, legSeconds, planRoute } from './index';

const ME = 'me';
const THEM = 'them';

function ownership(codeToOwner: Record<string, string>) {
  return new Map(PROVINCES.map((p) => [p.key, codeToOwner[p.countryCode] ?? THEM]));
}
const usa = ownership({ USA: ME });
const baseCtx = { countryId: ME, ownerByKey: usa, railwayKeys: new Set<string>(), speed: 1, gameSpeed: 1 };

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
    const route = planRoute('p0_0', 'p2_1', baseCtx)!;
    expect(route.path[0]).toBe('p0_0');
    expect(route.path.at(-1)).toBe('p2_1');
    expect(route.path.length).toBe(4);
    expect(route.legSeconds.length).toBe(3);
    for (const key of route.path) expect(usa.get(key)).toBe(ME);
  });

  it('refuses enemy destinations', () => {
    expect(planRoute('p0_0', 'p0_3', baseCtx)).toBeNull();
  });

  it('railways halve a leg and faster units arrive sooner', () => {
    const slow = planRoute('p0_0', 'p2_1', baseCtx)!;
    const fast = planRoute('p0_0', 'p2_1', { ...baseCtx, speed: 2 })!;
    const rail = planRoute('p0_0', 'p2_1', { ...baseCtx, railwayKeys: new Set(slow.path) })!;
    expect(fast.totalSeconds).toBeLessThan(slow.totalSeconds * 0.6);
    expect(rail.totalSeconds).toBeLessThan(slow.totalSeconds * 0.6);
  });

  it('game speed shortens travel', () => {
    expect(legSeconds('p0_0', 'p0_1', 1, false, 60)).toBeLessThan(legSeconds('p0_0', 'p0_1', 1, false, 1) / 50);
  });

  it('applies several finished legs after being offline, without drifting', () => {
    const route = planRoute('p0_0', 'p2_1', baseCtx)!;
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
      ownerByKey: usa,
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
    const route = planRoute('p0_0', 'p2_1', baseCtx)!;
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
      ownerByKey: lost,
      railwayKeys: new Set<string>(),
    });
    expect(result).toEqual({ status: 'blocked', locationKey: route.path[1] });
  });
});
