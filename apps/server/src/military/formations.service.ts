import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { UnitType } from '@cw/shared';
import { DB, Db } from '../db/db.module';
import { formationUnits, formations } from '../db/schema';
import { EconomyService } from '../economy/economy.service';
import { PlayersService } from '../players/players.service';
import { RealtimeService } from '../realtime/realtime.service';
import { moveGeneral } from '../generals/generals.queries';
import { MovementService } from './movement.service';

/** Army management in place: split units off into a task force, or merge two armies into one. */
@Injectable()
export class FormationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly economy: EconomyService,
    private readonly players: PlayersService,
    private readonly movement: MovementService,
    private readonly realtime: RealtimeService,
  ) {}

  async split(userId: string, campaignId: string, formationId: string, send: Partial<Record<UnitType, number>>) {
    const player = await this.players.require(userId, campaignId);
    const result = await this.economy.lock(player.countryId, async (tx, country) => {
      const [formation] = await tx
        .select()
        .from(formations)
        .where(and(eq(formations.id, formationId), eq(formations.campaignId, campaignId)))
        .for('update');
      if (!formation || formation.countryId !== country.id) throw new NotFoundException('Army not found');
      if (formation.moveArrivesAt) throw new BadRequestException('An army on the march cannot be split');
      const units = await tx.select().from(formationUnits).where(eq(formationUnits.formationId, formation.id));
      const { target } = await this.movement.split(tx, formation, units, send);
      if (target.id === formation.id) throw new BadRequestException('Keep at least one unit in the original army');
      return { formationId: target.id };
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'army' });
    return { ok: true, ...result };
  }

  async merge(userId: string, campaignId: string, formationId: string, intoId: string) {
    if (formationId === intoId) throw new BadRequestException('Pick a different army to merge into');
    const player = await this.players.require(userId, campaignId);
    await this.economy.lock(player.countryId, async (tx, country) => {
      const rows = await tx
        .select()
        .from(formations)
        .where(and(inArray(formations.id, [formationId, intoId]), eq(formations.campaignId, campaignId)))
        .for('update');
      const source = rows.find((r) => r.id === formationId);
      const target = rows.find((r) => r.id === intoId);
      if (!source || !target || source.countryId !== country.id || target.countryId !== country.id) {
        throw new NotFoundException('Army not found');
      }
      if (source.moveArrivesAt || target.moveArrivesAt) throw new BadRequestException('Armies on the march cannot be merged');
      if (source.provinceId !== target.provinceId) throw new BadRequestException('Both armies must be in the same province');

      const sourceUnits = await tx.select().from(formationUnits).where(eq(formationUnits.formationId, source.id));
      const targetUnits = await tx.select().from(formationUnits).where(eq(formationUnits.formationId, target.id));
      for (const u of sourceUnits) {
        const same = targetUnits.find((t) => t.unitType === u.unitType);
        if (same) {
          await tx.update(formationUnits).set({ count: same.count + u.count }).where(eq(formationUnits.id, same.id));
          await tx.delete(formationUnits).where(eq(formationUnits.id, u.id));
        } else {
          await tx.update(formationUnits).set({ formationId: target.id }).where(eq(formationUnits.id, u.id));
        }
      }
      await moveGeneral(tx, source.id, target.id);
      await tx.delete(formations).where(eq(formations.id, source.id));
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'army' });
    return { ok: true };
  }
}
