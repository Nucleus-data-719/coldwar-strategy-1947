import { describe, it, expect } from 'vitest';
import { mineLossPct, SEA_RANGE, fleetRange, navalEngagement, hopsFrom, seaPathNodes, isHiddenFleet, minelayerCount, nearestSeaNode, firingPosition } from './naval';
import { SEA_DOTS, seaNeighbors } from './map-data';

describe('naval ranges', () => {
  it('matches the design', () => {
    expect(SEA_RANGE.submarine).toBe(0);
    expect(SEA_RANGE.destroyer).toBe(1);
    expect(SEA_RANGE.corvette).toBe(1);
    expect(SEA_RANGE.battleship).toBe(2);
  });
  it('fleet closes to its shortest range', () => {
    expect(fleetRange([{ unitType: 'battleship', count: 2 }, { unitType: 'destroyer', count: 1 }])).toBe(1);
    expect(fleetRange([{ unitType: 'battleship', count: 2 }, { unitType: 'submarine', count: 1 }])).toBe(0);
  });
  it('subs hide, minelayers counted', () => {
    expect(isHiddenFleet([{ unitType: 'submarine', count: 2 }])).toBe(true);
    expect(isHiddenFleet([{ unitType: 'submarine', count: 2 }, { unitType: 'destroyer', count: 1 }])).toBe(false);
    expect(minelayerCount([{ unitType: 'battleship', count: 3 }, { unitType: 'corvette', count: 2 }])).toBe(2);
  });
});

describe('dots', () => {
  it('hops and paths agree', () => {
    const a = 0;
    const b = seaNeighbors(a)[0];
    expect(hopsFrom([a], 2).get(b)).toBe(1);
    expect(seaPathNodes(a, b)).toEqual([a, b]);
    expect(nearestSeaNode(SEA_DOTS[a][0], SEA_DOTS[a][1])).toBe(a);
    expect(firingPosition([a, b], b, 1)).toEqual([a]);
  });
});

describe('naval engagement', () => {
  const bb = [{ unitType: 'battleship' as const, count: 3 }];
  const dd = [{ unitType: 'destroyer' as const, count: 3 }];
  it('battleship outranges destroyer at 2 hops', () => {
    const r = navalEngagement({ seed: 1, attackerUnits: bb, defenderUnits: dd, hops: 2 });
    expect(r.defenderLossPct).toBeGreaterThan(0);
    expect(r.attackerLossPct).toBe(0);
  });
  it('destroyers hurt subs far more per ship than battleships do', () => {
    const sub = [{ unitType: 'submarine' as const, count: 6 }];
    const one = (t: 'battleship' | 'destroyer', n: number) =>
      navalEngagement({ seed: 2, attackerUnits: [{ unitType: t, count: n }], defenderUnits: sub, hops: 0 }).defenderLossPct;
    // 2 battleships weigh 640 hp, 6 destroyers 660 hp: similar mass, destroyers should do better vs subs
    expect(one('destroyer', 6) > one('battleship', 2)).toBe(true);
  });
});

describe('balance guard rails', () => {
  it('mines hurt but never wipe out a fleet', () => {
    expect(mineLossPct(3) > 0).toBe(true);
    expect(mineLossPct(20) <= 0.25).toBe(true);
  });
});
