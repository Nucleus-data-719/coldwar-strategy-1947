import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DB, Db } from '../db/db.module';
import { countries, players, users } from '../db/schema';

/**
 * Tracks when a user was last active. Activity also hands a country back from
 * the AI to its human player if the AI had taken over during their absence.
 */
@Injectable()
export class ActivityService {
  private readonly log = new Logger(ActivityService.name);
  private readonly lastTouch = new Map<string, number>();

  constructor(@Inject(DB) private readonly db: Db) {}

  async touch(userId: string): Promise<void> {
    const now = Date.now();
    const last = this.lastTouch.get(userId) ?? 0;
    if (now - last < 60_000) return;
    this.lastTouch.set(userId, now);
    try {
      await this.db.update(users).set({ lastSeenAt: new Date(now) }).where(eq(users.id, userId));
      const mine = await this.db
        .select({ countryId: players.countryId })
        .from(players)
        .where(eq(players.userId, userId));
      if (mine.length > 0) {
        await this.db
          .update(countries)
          .set({ aiControlled: false })
          .where(
            inArray(
              countries.id,
              mine.map((m) => m.countryId),
            ),
          );
      }
    } catch (err) {
      this.log.warn(`touch failed: ${(err as Error).message}`);
    }
  }
}
