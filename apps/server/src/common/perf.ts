import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

interface RouteStat {
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  /** Ring of recent durations, for percentiles. */
  recent: number[];
}

const stats = new Map<string, RouteStat>();
const log = new Logger('Perf');
const RECENT = 200;
const startedAt = Date.now();

/** Collapses ids so /campaigns/<uuid>/state and /campaigns/<other uuid>/state count as one route. */
function routeKey(req: Request): string {
  const path = (req.originalUrl || req.url).split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id').replace(/\/\d+/g, '/:n');
  return `${req.method} ${path}`;
}

/** Times every request. Slow ones are logged; all are summarised by /api/metrics. */
export function timingMiddleware(req: Request, res: Response, next: NextFunction) {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const key = routeKey(req);
    let s = stats.get(key);
    if (!s) {
      s = { count: 0, errors: 0, totalMs: 0, maxMs: 0, recent: [] };
      stats.set(key, s);
    }
    s.count++;
    s.totalMs += ms;
    if (ms > s.maxMs) s.maxMs = ms;
    if (res.statusCode >= 500) s.errors++;
    s.recent.push(ms);
    if (s.recent.length > RECENT) s.recent.shift();
    if (ms >= env.SLOW_REQUEST_MS) log.warn(`slow ${key} ${res.statusCode} ${ms.toFixed(0)} ms`);
  });
  next();
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);

/** A summary of request timings since the server started, slowest routes first. */
export function metricsSnapshot() {
  const routes = [...stats.entries()].map(([route, s]) => {
    const sorted = [...s.recent].sort((a, b) => a - b);
    return {
      route,
      count: s.count,
      errors: s.errors,
      avgMs: Math.round(s.totalMs / s.count),
      p50Ms: Math.round(pct(sorted, 0.5)),
      p95Ms: Math.round(pct(sorted, 0.95)),
      maxMs: Math.round(s.maxMs),
    };
  });
  routes.sort((a, b) => b.p95Ms - a.p95Ms);
  const mem = process.memoryUsage();
  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    rssMb: Math.round(mem.rss / 1048576),
    heapMb: Math.round(mem.heapUsed / 1048576),
    routes,
  };
}

/** Runs `fn` and logs a warning if it takes longer than `warnMs`. Used around scheduler and AI work. */
export async function timed<T>(label: string, warnMs: number, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - t0;
    if (ms >= warnMs) log.warn(`${label} took ${ms} ms`);
  }
}
