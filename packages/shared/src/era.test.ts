import { describe, expect, it } from 'vitest';
import {
  PROVINCES,
  PROVINCE_BY_KEY,
  UNITS,
  airOrderProblem,
  hasPort,
  isSealiftLeg,
  legSeconds,
  planRoute,
  provinceKm,
  roadBetween,
  startingTechs,
  summariseResearch,
  type UnitType,
} from './index';

const ME = 'me';
const usa = new Map(PROVINCES.map((p) => [p.key, p.countryCode === 'USA' ? ME : p.countryCode]));
const ctx = (units: { unitType: UnitType; count: number }[], extra: object = {}) => ({
  countryId: ME,
  ownerByKey: usa,
  atWarWith: new Set<string>(),
  railwayKeys: new Set<string>(),
  speed: Math.min(...units.map((u) => UNITS[u.unitType].speed)),
  gameSpeed: 1,
  useRoads: true,
  units,
  ...extra,
});
const inf = [{ unitType: 'infantry' as const, count: 5 }];

describe('1950s distances and speeds', () => {
  it('measures real kilometres', () => {
    // Washington to Chicago is about 950 km in a straight line.
    const km = provinceKm('washington', 'chicago');
    expect(km).toBeGreaterThan(850);
    expect(km).toBeLessThan(1050);
  });

  it('an infantry march Washington to Chicago takes several game hours (days of 1950s campaigning)', () => {
    const r = planRoute('washington', 'chicago', ctx(inf))!;
    const hours = r.totalSeconds / 3600;
    expect(hours).toBeGreaterThan(3);
    expect(hours).toBeLessThan(12);
  });

  it('jets are about a hundred times faster than marching troops', () => {
    const march = planRoute('washington', 'chicago', ctx(inf))!.totalSeconds;
    const fighters = [{ unitType: 'fighter' as const, count: 4 }];
    const flight = planRoute('washington', 'chicago', { ...ctx(fighters), useRoads: false, air: true })!;
    expect(flight.path).toEqual(['washington', 'chicago']);
    expect(flight.totalSeconds * 50).toBeLessThan(march);
  });

  it('each unit pays its own terrain: tanks bog down in mountains, light tanks outrun infantry on plains', () => {
    const roads = PROVINCES.flatMap((p) => p.roads.filter((k) => roadBetween(p.key, k) !== 'ferry').map((k) => [p.key, k] as const));
    const mountain = roads.find(([a, b]) => PROVINCE_BY_KEY[a].terrain === 'mountains' && PROVINCE_BY_KEY[b].terrain === 'mountains')!;
    const plains = roads.find(([a, b]) => PROVINCE_BY_KEY[a].terrain === 'plains' && PROVINCE_BY_KEY[b].terrain === 'plains')!;
    const t = (leg: readonly [string, string], type: UnitType) =>
      legSeconds(leg[0], leg[1], UNITS[type].speed, false, 1, 1, false, { units: [{ unitType: type, count: 1 }] });
    // heavy tanks and towed guns have the same road speed, but tracks suffer more in the mountains
    expect(t(mountain, 'heavy_tank')).toBeGreaterThan(t(mountain, 'artillery'));
    expect(t(plains, 'light_tank')).toBeLessThan(t(plains, 'infantry'));
    // a mixed army moves at its slowest unit
    const mixed = legSeconds(mountain[0], mountain[1], 6, false, 1, 1, false, {
      units: [{ unitType: 'infantry', count: 3 }, { unitType: 'heavy_tank', count: 1 }],
    });
    expect(mixed).toBe(t(mountain, 'heavy_tank'));
  });

  it('troop trains carry every unit at the same speed', () => {
    const [a, b] = ['washington', PROVINCE_BY_KEY.washington.roads[0]];
    const rail = (type: UnitType) => legSeconds(a, b, UNITS[type].speed, [true, true], 1, 1, false, { units: [{ unitType: type, count: 1 }] });
    expect(rail('heavy_tank')).toBe(rail('infantry'));
    const road = legSeconds(a, b, 6, false, 1, 1, false, { units: [{ unitType: 'heavy_tank', count: 1 }] });
    expect(rail('heavy_tank')).toBeLessThan(road / 3);
  });
});

describe('sealift and amphibious landings', () => {
  const ports = PROVINCES.filter((p) => p.countryCode === 'USA' && hasPort(p.key)).map((p) => p.key);
  const start = ports.find((k) => PROVINCE_BY_KEY[k].center.x > 1000) ?? ports[0];
  const far = ports
    .filter((k) => isSealiftLeg(start, k))
    .sort((x, y) => provinceKm(start, y) - provinceKm(start, x))[0];

  it('troops in a harbour may sail to another port when that is quicker than marching', () => {
    const overland = planRoute(start, far, ctx(inf));
    const withHarbor = planRoute(start, far, ctx(inf, { harborKeys: new Set([start]) }))!;
    expect(withHarbor).not.toBeNull();
    if (overland) expect(withHarbor.totalSeconds).toBeLessThanOrEqual(overland.totalSeconds);
  });

  it('without a harbour at the start there is no sealift', () => {
    const r = planRoute(start, far, ctx(inf));
    if (r) expect(r.path.length).toBeGreaterThan(2);
  });

  it('an overseas enemy port can be assaulted from the sea only from a harbour', () => {
    const target = PROVINCES.find((p) => p.countryCode === 'GBR' && isSealiftLeg(start, p.key))!;
    const war = { atWarWith: new Set(['GBR']) };
    expect(planRoute(start, target.key, ctx(inf, war))).toBeNull();
    const assault = planRoute(start, target.key, ctx(inf, { ...war, harborKeys: new Set([start]) }))!;
    expect(assault.path).toEqual([start, target.key]);
  });
});

describe('air ranges', () => {
  const fighters = [{ unitType: 'fighter' as const, count: 4 }];
  const bombers = [{ unitType: 'bomber' as const, count: 4 }];
  const base = 'washington';
  const near = PROVINCES.filter((p) => p.countryCode === 'USA' && p.key !== base).sort((a, b) => provinceKm(base, a.key) - provinceKm(base, b.key))[0].key;
  const farAway = PROVINCES.find((p) => p.countryCode === 'SOV')!.key;
  const check = (kind: 'strike' | 'rebase' | 'patrol', toKey: string, units = fighters, airbases = [base]) =>
    airOrderProblem({ kind, fromKey: base, toKey, units, countryId: ME, ownerByKey: usa, airbaseKeys: new Set(airbases) });

  it('fighters reach targets near their airbase only; bombers reach much farther', () => {
    expect(check('strike', near)).toBeNull();
    expect(check('patrol', farAway)).toMatch(/Out of range/);
    const midway = PROVINCES.find((p) => {
      const km = provinceKm(base, p.key);
      return km > UNITS.fighter.rangeKm! * 1.2 && km < UNITS.bomber.rangeKm! * 0.8;
    })!.key;
    expect(check('strike', midway)).toMatch(/Out of range/);
    expect(check('strike', midway, bombers)).toBeNull();
  });

  it('aircraft rebase only to an airbase of their own, within ferry range', () => {
    expect(check('rebase', near)).toMatch(/airbase/);
    expect(check('rebase', near, fighters, [base, near])).toBeNull();
    expect(check('rebase', farAway, fighters, [base, farAway])).not.toBeNull();
  });
});

describe('1950 starting technology', () => {
  it('superpowers start with jets, bombers, tanks and submarines; small countries with nothing', () => {
    expect(startingTechs('USA')).toEqual(expect.arrayContaining(['armor_1', 'air_1', 'air_2', 'naval_1', 'naval_2']));
    expect(startingTechs('GBR')).toEqual(expect.arrayContaining(['armor_1', 'air_1', 'naval_1']));
    expect(startingTechs('GBR')).not.toContain('air_2');
    const minor = PROVINCES.find((p) => !['super', 'major', 'medium'].includes(String(p.countryCode)) && startingTechs(p.countryCode).length === 0);
    expect(minor).toBeDefined();
    const s = summariseResearch(startingTechs('USA'), 0, 0);
    expect(s.unlockedUnits).toEqual(expect.arrayContaining(['light_tank', 'fighter', 'bomber', 'destroyer', 'submarine']));
  });
});
