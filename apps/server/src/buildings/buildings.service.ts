import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  BUILDINGS,
  canAfford,
  scaleSeconds,
  spend,
  type BuildingType,
  type Resources,
} from '@cw/shared';
import { env } from '../config/env';
import { DB, Db, DbOrTx } from '../db/db.module';
import { buildings, BuildingRow, CountryRow, provinces } from '../db/schema';
import { EconomyService } from '../economy/economy.service';
import { PlayersService } from '../players/players.service';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class BuildingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly economy: EconomyService,
    private readonly players: PlayersService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Validates and starts construction. Must run inside `economy.lock` after `settle`,
   * with `balance` being the settled balance. Returns the balance after paying.
   */
  async constructLocked(
    tx: DbOrTx,
    country: CountryRow,
    balance: Resources,
    provinceId: string,
    type: BuildingType,
  ): Promise<{ balance: Resources; building: BuildingRow }> {
    const def = BUILDINGS[type];
    if (!def) throw new BadRequestException('Unknown building type');

    const [province] = await tx
      .select()
      .from(provinces)
      .where(and(eq(provinces.id, provinceId), eq(provinces.campaignId, country.campaignId)));
    if (!province) throw new NotFoundException('Province not found');
    if (province.ownerCountryId !== country.id) throw new ForbiddenException('You do not own this province');
    if (def.requiresCoastal && !province.isCoastal) {
      throw new BadRequestException(`${def.name} can only be built in coastal provinces`);
    }

    const existing = await tx.select().from(buildings).where(eq(buildings.provinceId, province.id));
    if (existing.some((b) => b.type === type)) {
      throw new ConflictException(`This province already has a ${def.name}`);
    }
    if (existing.length >= province.buildingSlots) {
      throw new BadRequestException('No free building slots in this province');
    }
    if (!canAfford(balance, def.cost)) throw new BadRequestException('Not enough resources');

    const newBalance = spend(balance, def.cost);
    await this.economy.writeBalance(tx, country.id, newBalance);

    const now = new Date();
    const [building] = await tx
      .insert(buildings)
      .values({
        campaignId: country.campaignId,
        provinceId: province.id,
        type,
        status: 'constructing',
        startedAt: now,
        completesAt: new Date(now.getTime() + scaleSeconds(def.buildSeconds, env.GAME_SPEED) * 1000),
      })
      .returning();
    return { balance: newBalance, building };
  }

  /** Player command: build `type` in `provinceId`. */
  async construct(userId: string, campaignId: string, provinceId: string, type: BuildingType) {
    const player = await this.players.require(userId, campaignId);
    const result = await this.economy.lock(player.countryId, async (tx, country) => {
      const balance = await this.economy.settle(tx, country);
      return this.constructLocked(tx, country, balance, provinceId, type);
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'building', provinceId });
    return { ok: true, completesAt: result.building.completesAt.toISOString() };
  }
}
