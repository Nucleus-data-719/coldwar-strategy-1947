import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { WarDto } from '@cw/shared';
import { DB, Db, DbOrTx } from '../db/db.module';
import { alliances, countries, wars } from '../db/schema';
import { allianceBetween, onWarDeclared } from '../diplomacy/diplomacy.queries';
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

    const notes = await this.economy.lockMany([player.countryId, targetCountryId], async (tx, rows) => {
      const me = rows.get(player.countryId)!;
      const target = rows.get(targetCountryId)!;
      if (target.campaignId !== campaignId) throw new NotFoundException('Country not found in this campaign');
      if ((await this.enemiesOf(tx, me.id)).has(target.id)) {
        throw new BadRequestException(`You are already at war with ${target.name}`);
      }
      const pact = await allianceBetween(tx, me.id, target.id);
      if (pact?.status === 'active') {
        throw new BadRequestException(`You are allied with ${target.name}. Break the alliance first.`);
      }
      await tx.insert(wars).values({ campaignId, aggressorId: me.id, defenderId: target.id });
      if (pact) await tx.delete(alliances).where(eq(alliances.id, pact.id)); // a pending proposal lapses
      const calls = await onWarDeclared(tx, campaignId, me.id, target.id);

      const out = [
        await this.notifications.add(tx, {
          campaignId,
          countryId: target.id,
          type: 'war_declared',
          message: `${me.name} has declared war on you!`,
        }),
      ];
      for (const c of calls) {
        out.push(
          await this.notifications.add(tx, {
            campaignId,
            countryId: c.allyId,
            type: 'war_call',
            message: `${target.name}, your ally, was attacked by ${me.name}. You will join the war automatically unless you decline. Open Diplomacy.`,
          }),
        );
      }
      return out;
    });
    for (const n of notes) this.notifications.publish(n);
    this.realtime.campaignUpdate(campaignId, { kind: 'war' });
    return { ok: true };
  }
}
