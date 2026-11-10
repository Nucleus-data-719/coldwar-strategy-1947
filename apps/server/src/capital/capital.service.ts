import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import {
  CAPITAL_DEFENSE,
  CAPITAL_MOVE_COST,
  CAPITAL_MOVE_SECONDS,
  PROVINCE_DEFENSE,
  canAfford,
  scaleSeconds,
  spend,
} from '@cw/shared';
import { env } from '../config/env';
import { DB, Db } from '../db/db.module';
import { countries, provinces } from '../db/schema';
import { EconomyService } from '../economy/economy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlayersService } from '../players/players.service';
import { RealtimeService } from '../realtime/realtime.service';

/** Moving the capital costs resources and takes a day (game time); the old capital stays in place meanwhile. */
@Injectable()
export class CapitalService {
  private readonly log = new Logger(CapitalService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly economy: EconomyService,
    private readonly players: PlayersService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async relocate(userId: string, campaignId: string, provinceId: string) {
    const player = await this.players.require(userId, campaignId);
    const completesAt = await this.economy.lock(player.countryId, async (tx, country) => {
      if (country.capitalMoveAt) throw new BadRequestException('A capital move is already under way');
      const [province] = await tx
        .select()
        .from(provinces)
        .where(and(eq(provinces.id, provinceId), eq(provinces.campaignId, campaignId)));
      if (!province || province.ownerCountryId !== country.id) throw new BadRequestException('Choose one of your own provinces');
      if (province.id === country.capitalProvinceId) throw new BadRequestException('That province is already your capital');
      if (province.disruptedUntil) throw new BadRequestException('An occupied province cannot become the capital yet');

      const balance = await this.economy.settle(tx, country);
      if (!canAfford(balance, CAPITAL_MOVE_COST)) throw new BadRequestException('Not enough resources to move the capital');
      await this.economy.writeBalance(tx, country.id, spend(balance, CAPITAL_MOVE_COST));

      const at = new Date(Date.now() + scaleSeconds(CAPITAL_MOVE_SECONDS, env.GAME_SPEED) * 1000);
      await tx.update(countries).set({ capitalMoveProvinceId: province.id, capitalMoveAt: at }).where(eq(countries.id, country.id));
      return at;
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'capital' });
    return { ok: true, completesAt: completesAt.toISOString() };
  }

  /** Scheduler hook: completes capital moves whose delay is over. */
  async processDue(): Promise<void> {
    const due = await this.db
      .select({ id: countries.id, campaignId: countries.campaignId })
      .from(countries)
      .where(and(isNotNull(countries.capitalMoveAt), lte(countries.capitalMoveAt, new Date())))
      .limit(50);

    for (const d of due) {
      try {
        const note = await this.economy.lock(d.id, async (tx, country) => {
          if (!country.capitalMoveAt || country.capitalMoveAt > new Date() || !country.capitalMoveProvinceId) return null;
          const [target] = await tx.select().from(provinces).where(eq(provinces.id, country.capitalMoveProvinceId));
          const clear = { capitalMoveProvinceId: null, capitalMoveAt: null };
          if (!target || target.ownerCountryId !== country.id) {
            await tx.update(countries).set(clear).where(eq(countries.id, country.id));
            return this.notifications.add(tx, {
              campaignId: country.campaignId,
              countryId: country.id,
              type: 'capital_move_failed',
              message: 'The capital move failed: the new capital was lost before it was ready.',
            });
          }
          if (country.capitalProvinceId) {
            await tx.update(provinces).set({ defense: PROVINCE_DEFENSE }).where(eq(provinces.id, country.capitalProvinceId));
          }
          await tx.update(provinces).set({ defense: CAPITAL_DEFENSE }).where(eq(provinces.id, target.id));
          await tx.update(countries).set({ capitalProvinceId: target.id, ...clear }).where(eq(countries.id, country.id));
          return this.notifications.add(tx, {
            campaignId: country.campaignId,
            countryId: country.id,
            type: 'capital_moved',
            message: `${target.name} is now your capital.`,
          });
        });
        if (note) {
          this.notifications.publish(note);
          this.realtime.campaignUpdate(d.campaignId, { kind: 'capital' });
        }
      } catch (err) {
        this.log.warn(`capital ${d.id}: ${(err as Error).message}`);
      }
    }
  }
}
