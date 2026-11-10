import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { WarDto } from '@cw/shared';
import { DB, Db, DbOrTx } from '../db/db.module';
import { countries, wars } from '../db/schema';
import { EconomyService } from '../economy/economy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlayersService } from '../players/players.service';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class WarsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly economy: EconomyService,
    private readonly players: PlayersService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Ids of every country this one is currently at war with. */
  async enemiesOf(db: DbOrTx, countryId: string): Promise<Set<string>> {
    const rows = await db
      .select()
      .from(wars)
      .where(and(isNull(wars.endedAt), or(eq(wars.aggressorId, countryId), eq(wars.defenderId, countryId))));
    return new Set(rows.map((w) => (w.aggressorId === countryId ? w.defenderId : w.aggressorId)));
  }

  async list(userId: string, campaignId: string): Promise<WarDto[]> {
    const player = await this.players.require(userId, campaignId);
    const rows = await this.db
      .select()
      .from(wars)
      .where(
        and(
          isNull(wars.endedAt),
          or(eq(wars.aggressorId, player.countryId), eq(wars.defenderId, player.countryId)),
        ),
      );
    const names = new Map(
      (await this.db.select({ id: countries.id, name: countries.name }).from(countries).where(eq(countries.campaignId, campaignId))).map(
        (c) => [c.id, c.name],
      ),
    );
    return rows.map((w) => {
      const mine = w.aggressorId === player.countryId;
      const enemy = mine ? w.defenderId : w.aggressorId;
      return {
        id: w.id,
        enemyCountryId: enemy,
        enemyName: names.get(enemy) ?? 'Unknown',
        declaredAt: w.declaredAt.toISOString(),
        declaredByYou: mine,
      };
    });
  }

  /** Player command: declare war. It starts immediately; armies can cross the border from then on. */
  async declare(userId: string, campaignId: string, targetCountryId: string) {
    const player = await this.players.require(userId, campaignId);
    if (targetCountryId === player.countryId) throw new BadRequestException('You cannot declare war on yourself');

    const note = await this.economy.lockMany([player.countryId, targetCountryId], async (tx, rows) => {
      const me = rows.get(player.countryId)!;
      const target = rows.get(targetCountryId)!;
      if (target.campaignId !== campaignId) throw new NotFoundException('Country not found in this campaign');
      if ((await this.enemiesOf(tx, me.id)).has(target.id)) {
        throw new BadRequestException(`You are already at war with ${target.name}`);
      }
      await tx.insert(wars).values({ campaignId, aggressorId: me.id, defenderId: target.id });
      return this.notifications.add(tx, {
        campaignId,
        countryId: target.id,
        type: 'war_declared',
        message: `${me.name} has declared war on you!`,
      });
    });
    this.notifications.publish(note);
    this.realtime.campaignUpdate(campaignId, { kind: 'war' });
    return { ok: true };
  }
}
