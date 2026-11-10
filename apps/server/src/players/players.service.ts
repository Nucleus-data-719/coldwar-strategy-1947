import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Db } from '../db/db.module';
import { players, PlayerRow } from '../db/schema';

@Injectable()
export class PlayersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The player record of this user in this campaign, or 403 if they have not joined. */
  async require(userId: string, campaignId: string): Promise<PlayerRow> {
    const [player] = await this.db
      .select()
      .from(players)
      .where(and(eq(players.userId, userId), eq(players.campaignId, campaignId)));
    if (!player) throw new ForbiddenException('You have not joined this campaign');
    return player;
  }
}
