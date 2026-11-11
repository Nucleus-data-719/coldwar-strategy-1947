import { describe, it, expect } from 'vitest';
import { isAirFormation, lossCount, overHours, patrolHour, patrolRadius, provincesInCircle, patrolFlightSeconds } from './patrol';

const none = { enemyGroundUnits: 0, enemyArmies: 0, enemyProvinces: 0, enemyAirPower: 0, enemyBuildings: 0 };

describe('air patrol', () => {
  it('only air forces can patrol, and the shortest range wins', () => {
    expect(isAirFormation([{ unitType: 'fighter', count: 2 }])).toBe(true);
    expect(isAirFormation([{ unitType: 'fighter', count: 2 }, { unitType: 'infantry', count: 1 }])).toBe(false);
    expect(patrolRadius([{ unitType: 'fighter', count: 2 }])).toBe(100);
    expect(patrolRadius([{ unitType: 'fighter', count: 2 }, { unitType: 'bomber', count: 1 }])).toBe(80);
    expect(patrolRadius([{ unitType: 'infantry', count: 4 }])).toBe(0);
  });

  it('the circle covers the patrol province and some neighbours', () => {
    const inside = provincesInCircle('washington', 100);
    expect(inside).toContain('washington');
    expect(inside.length).toBeGreaterThan(1);
    expect(provincesInCircle('washington', 100).length).toBeLessThan(provincesInCircle('washington', 400).length);
  });

  it('bombers hurt armies and buildings, fighters mostly do not', () => {
    const s = { ...none, enemyGroundUnits: 20, enemyArmies: 2, enemyBuildings: 2, enemyProvinces: 1 };
    const bombers = patrolHour([{ unitType: 'bomber', count: 10 }], s);
    const fighters = patrolHour([{ unitType: 'fighter', count: 10 }], s);
    expect(bombers.groundLossPct).toBeGreaterThan(fighters.groundLossPct);
    expect(bombers.buildingPoints).toBeGreaterThan(0);
    expect(fighters.buildingPoints).toBe(0);
  });

  it('there is no air defence over friendly land, so patrolling there costs nothing without enemy aircraft', () => {
    const calm = patrolHour([{ unitType: 'bomber', count: 10 }], { ...none, enemyGroundUnits: 10 });
    expect(calm.ownLossPct).toBe(0);
    const hostile = patrolHour([{ unitType: 'bomber', count: 10 }], { ...none, enemyGroundUnits: 10, enemyProvinces: 2 });
    expect(hostile.ownLossPct).toBeGreaterThan(0);
  });

  it('bombing is spread thinner over many armies', () => {
    const few = patrolHour([{ unitType: 'bomber', count: 10 }], { ...none, enemyGroundUnits: 40, enemyArmies: 2 });
    const many = patrolHour([{ unitType: 'bomber', count: 10 }], { ...none, enemyGroundUnits: 40, enemyArmies: 12 });
    expect(many.groundLossPct).toBeLessThan(few.groundLossPct);
  });

  it('nothing happens when there is no enemy in the circle', () => {
    const h = patrolHour([{ unitType: 'bomber', count: 10 }], none);
    expect(h.groundLossPct).toBe(0);
    expect(h.buildingPoints).toBe(0);
    expect(h.enemyAirLossPct).toBe(0);
  });

  it('dogfights hurt both sides, the stronger side less', () => {
    const strong = patrolHour([{ unitType: 'fighter', count: 20 }], { ...none, enemyAirPower: 100 });
    const weak = patrolHour([{ unitType: 'fighter', count: 2 }], { ...none, enemyAirPower: 600 });
    expect(strong.ownLossPct).toBeLessThan(weak.ownLossPct);
    expect(strong.enemyAirLossPct).toBeGreaterThan(weak.enemyAirLossPct);
  });

  it('losses are whole units and follow the rate over time', () => {
    expect(lossCount(10, 0.25, 9999)).toBe(2);
    expect(lossCount(10, 0.25, 0)).toBe(3);
    expect(lossCount(3, 2, 5)).toBe(3);
    expect(overHours(0.1, 2)).toBeGreaterThan(0.1);
    expect(overHours(0.1, 2)).toBeLessThan(0.2);
  });

  it('flights take longer over distance', () => {
    expect(patrolFlightSeconds('washington', 'chicago', 4, 60)).toBeGreaterThan(0);
    expect(patrolFlightSeconds('washington', 'chicago', 1, 60)).toBeGreaterThan(patrolFlightSeconds('washington', 'chicago', 4, 60));
  });
});
