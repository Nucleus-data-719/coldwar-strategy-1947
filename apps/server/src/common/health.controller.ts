import { Controller, ForbiddenException, Get, Headers, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { env } from '../config/env';
import { DB, Db } from '../db/db.module';
import { metricsSnapshot } from './perf';

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

@Controller()
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** For the host's uptime check. Touches the database so a dead connection shows up. */
  @Get('health')
  @SkipThrottle()
  async health() {
    const t0 = Date.now();
    await this.db.execute(sql`select 1`);
    return { ok: true, dbMs: Date.now() - t0 };
  }

  /** Request timings per route. Needs the ADMIN_TOKEN from .env in the x-admin-token header; off when none is set. */
  @Get('metrics')
  @SkipThrottle()
  metrics(@Headers('x-admin-token') token?: string) {
    if (!env.ADMIN_TOKEN || !token || !sameSecret(token, env.ADMIN_TOKEN)) throw new ForbiddenException('Not allowed');
    return metricsSnapshot();
  }
}
