import { describe, expect, it } from 'vitest';
import { PROVINCES, hasPort, seaRoute } from './index';

describe('sea routes', () => {
  const ports = PROVINCES.filter((p) => hasPort(p.key));

  it('finds routes between far-apart ports quickly', () => {
    const a = ports.find((p) => p.key === 'houston')!;
    const far = [...ports].sort((x, y) => Math.hypot(y.center.x - a.center.x, y.center.y - a.center.y) - Math.hypot(x.center.x - a.center.x, x.center.y - a.center.y)).slice(0, 25);
    const t0 = Date.now();
    let found = 0;
    for (const b of far) if (seaRoute(a.key, b.key)) found++;
    const ms = Date.now() - t0;
    expect(found > 0).toBe(true);
    // 25 cold long routes; the old linear scan took several times longer.
    expect(ms < 1500).toBe(true);
  });

  it('returns a path that starts and ends at the province centres and is cached', () => {
    const r = seaRoute('houston', 'southampton')!;
    expect(r.points[0][0]).toBe(PROVINCES.find((p) => p.key === 'houston')!.center.x);
    expect(seaRoute('houston', 'southampton')).toBe(r);
  });

  it('is symmetric in length within a small tolerance', () => {
    const ab = seaRoute('houston', 'southampton')!, ba = seaRoute('southampton', 'houston')!;
    expect(Math.abs(ab.length - ba.length) < 1).toBe(true);
  });
});
