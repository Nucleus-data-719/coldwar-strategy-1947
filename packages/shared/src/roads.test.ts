import { describe, expect, it } from 'vitest';
import { PROVINCES, PROVINCE_BY_KEY, ROADS, SEA_DOTS, hasPort, planRoute, roadBetween, roadPath, seaRoute } from './index';

const components = (edges: (p: (typeof PROVINCES)[number]) => string[]) => {
  const seen = new Set<string>();
  let n = 0;
  for (const p of PROVINCES) {
    if (seen.has(p.key)) continue;
    n++;
    const stack = [p.key];
    while (stack.length) {
      const k = stack.pop()!;
      if (seen.has(k)) continue;
      seen.add(k);
      for (const nb of edges(PROVINCE_BY_KEY[k])) stack.push(nb);
    }
  }
  return n;
};

describe('roads', () => {
  it('every road joins two neighbouring provinces and is listed both ways', () => {
    for (const r of ROADS) {
      expect(PROVINCE_BY_KEY[r.a].adjacent).toContain(r.b);
      expect(PROVINCE_BY_KEY[r.b].roads).toContain(r.a);
      expect(PROVINCE_BY_KEY[r.a].roads).toContain(r.b);
    }
  });

  it('every pair of neighbouring provinces has a road', () => {
    for (const p of PROVINCES) for (const n of p.adjacent) expect(roadBetween(p.key, n)).toBeDefined();
  });

  it('every province has at least one road', () => {
    for (const p of PROVINCES) expect(p.roads.length).toBeGreaterThan(0);
  });

  it('roads keep every country as connected inside itself as its borders do', () => {
    const codes = [...new Set(PROVINCES.map((p) => p.countryCode))];
    const parts = (code: string, edges: (p: (typeof PROVINCES)[number]) => string[]) => {
      const own = PROVINCES.filter((p) => p.countryCode === code);
      const seen = new Set<string>();
      let n = 0;
      for (const start of own) {
        if (seen.has(start.key)) continue;
        n++;
        const stack = [start.key];
        while (stack.length) {
          const k = stack.pop()!;
          if (seen.has(k)) continue;
          seen.add(k);
          for (const nb of edges(PROVINCE_BY_KEY[k])) if (PROVINCE_BY_KEY[nb].countryCode === code) stack.push(nb);
        }
      }
      return n;
    };
    for (const code of codes) expect(parts(code, (p) => p.roads)).toBe(parts(code, (p) => p.adjacent));
  });

  it('land roads pass through the border between the two provinces, not across open water', () => {
    for (const r of ROADS) {
      if (r.kind === 'ferry') continue;
      const pts = roadPath(r.a, r.b);
      expect(pts.length).toBe(3);
    }
  });

  it('ferries follow the sea dots', () => {
    const ferry = ROADS.filter((r) => r.kind === 'ferry' && r.via.length >= 4);
    expect(ferry.length).toBeGreaterThan(5);
  });

  it('land routes use only roads, and highways are quicker than roads', () => {
    const owner = new Map(PROVINCES.map((p) => [p.key, 'me']));
    const ctx = { countryId: 'me', ownerByKey: owner, atWarWith: new Set<string>(), railwayKeys: new Set<string>(), speed: 1, gameSpeed: 1, useRoads: true };
    const route = planRoute('moscow', 'novosibirsk', ctx)!;
    expect(route).not.toBeNull();
    for (let i = 0; i < route.path.length - 1; i++) expect(roadBetween(route.path[i], route.path[i + 1])).toBeDefined();
    // Same distance on a highway takes less time than on a road: compare equal-terrain legs by ratio.
    const hw = ROADS.find((r) => r.kind === 'highway')!;
    const plain = ROADS.find((r) => r.kind === 'road' && PROVINCE_BY_KEY[r.b].terrain === PROVINCE_BY_KEY[hw.b].terrain)!;
    const d = (a: string, b: string) => Math.hypot(PROVINCE_BY_KEY[a].center.x - PROVINCE_BY_KEY[b].center.x, PROVINCE_BY_KEY[a].center.y - PROVINCE_BY_KEY[b].center.y);
    const secs = (r: { a: string; b: string }) => planRoute(r.a, r.b, { ...ctx, ownerByKey: owner })!.totalSeconds / d(r.a, r.b);
    expect(secs(hw)).toBeLessThan(secs(plain) * 1.0001);
  });

  it('ships sail along the sea dots from port to port', () => {
    expect(SEA_DOTS.length).toBeGreaterThan(500);
    const route = seaRoute('new_york', 'liverpool')!;
    expect(route).not.toBeNull();
    expect(route.points.length).toBeGreaterThan(4);
    const owner = new Map(PROVINCES.map((p) => [p.key, 'me']));
    const ctx = { countryId: 'me', ownerByKey: owner, atWarWith: new Set<string>(), railwayKeys: new Set<string>(), speed: 1, gameSpeed: 1, coastalOnly: true };
    const plan = planRoute('new_york', 'liverpool', ctx)!;
    expect(plan.path).toEqual(['new_york', 'liverpool']);
    expect(plan.totalSeconds).toBeGreaterThan(3600);
    expect(hasPort('chicago')).toBe(false);
    expect(planRoute('new_york', 'chicago', ctx)).toBeNull();
  });
});
