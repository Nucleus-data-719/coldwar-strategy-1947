import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import {
  FACTORY_QUEUE_LIMIT,
  MAX_ORDER_QUANTITY,
  UNITS,
  canAfford,
  scaleSeconds,
  spend,
  addResources,
  type PartialResources,
  type ProductionOrderDto,
  type UnitType,
} from '@cw/shared';
import { env } from '../config/env';
import { DB, Db } from '../db/db.module';
import { buildings, productionOrders, ProductionOrderRow, provinces } from '../db/schema';
import { EconomyService } from '../economy/economy.service';
import { addToGarrison } from '../military/garrison';
import { NotificationsService } from '../notifications/notifications.service';
import { PlayersService } from '../players/players.service';
import { RealtimeService } from '../realtime/realtime.service';
import { loadResearch } from '../research/research.queries';

export function toOrderDto(r: ProductionOrderRow): ProductionOrderDto {
  return {
    id: r.id,
    unitType: r.unitType,
    status: r.completesAt ? 'building' : 'queued',
    completesAt: r.completesAt ? r.completesAt.toISOString() : null,
  };
}

const duration = (unitType: UnitType) => scaleSeconds(UNITS[unitType].buildSeconds, env.GAME_SPEED) * 1000;

/**
 * Military factory queues. A factory builds one unit at a time. The price is paid when you order,
 * and a queued unit that has not started can be cancelled for a full refund. Each unit starts the
 * moment the one before it finished, so the queue keeps running through server downtime.
 */
@Injectable()
export class ProductionService {
  private readonly log = new Logger(ProductionService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly economy: EconomyService,
    private readonly players: PlayersService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async enqueue(userId: string, campaignId: string, provinceId: string, unitType: UnitType, quantity: number) {
    const def = UNITS[unitType];
    if (!def?.factoryProducible) throw new BadRequestException(`${def?.name ?? unitType} cannot be built in a factory yet`);
    if (quantity < 1 || quantity > MAX_ORDER_QUANTITY) {
      throw new BadRequestException(`Order between 1 and ${MAX_ORDER_QUANTITY} units at a time`);
    }
    const player = await this.players.require(userId, campaignId);

    await this.economy.lock(player.countryId, async (tx, country) => {
      const [province] = await tx
        .select()
        .from(provinces)
        .where(and(eq(provinces.id, provinceId), eq(provinces.campaignId, campaignId)));
      if (!province) throw new NotFoundException('Province not found');
      if (province.ownerCountryId !== country.id) throw new BadRequestException('Not your province');
      if (province.disruptedUntil) throw new BadRequestException('The province is occupied and cannot produce yet');
      const unlocked = (await loadResearch(tx, country.id)).summary.unlockedUnits;
      if (!unlocked.includes(unitType)) {
        throw new BadRequestException(`${def.name} has not been researched yet. Open the Research tab.`);
      }
      const [factory] = await tx
        .select({ id: buildings.id })
        .from(buildings)
        .where(
          and(eq(buildings.provinceId, province.id), eq(buildings.type, 'military_factory'), eq(buildings.status, 'complete')),
        );
      if (!factory) throw new BadRequestException('This province has no completed Military Factory');

      const queued = await tx
        .select({ id: productionOrders.id, position: productionOrders.position })
        .from(productionOrders)
        .where(eq(productionOrders.provinceId, province.id));
      const last = queued.reduce((m, r) => Math.max(m, r.position), 0);
      if (queued.length + quantity > FACTORY_QUEUE_LIMIT) {
        throw new BadRequestException(`The queue holds at most ${FACTORY_QUEUE_LIMIT} units`);
      }

      const total: PartialResources = {};
      for (const [k, v] of Object.entries(def.cost)) total[k as keyof PartialResources] = (v ?? 0) * quantity;
      const balance = await this.economy.settle(tx, country);
      if (!canAfford(balance, total)) throw new BadRequestException('Not enough resources for that order');
      await this.economy.writeBalance(tx, country.id, spend(balance, total));

      const now = Date.now();
      const start = queued.length === 0;
      let position = last + 1;
      await tx.insert(productionOrders).values(
        Array.from({ length: quantity }, (_, i) => ({
          campaignId,
          countryId: country.id,
          provinceId: province.id,
          unitType,
          position: position++,
          completesAt: start && i === 0 ? new Date(now + duration(unitType)) : null,
        })),
      );
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'production' });
    return { ok: true };
  }

  async cancel(userId: string, campaignId: string, orderId: string) {
    const player = await this.players.require(userId, campaignId);
    await this.economy.lock(player.countryId, async (tx, country) => {
      const [order] = await tx
        .select()
        .from(productionOrders)
        .where(and(eq(productionOrders.id, orderId), eq(productionOrders.campaignId, campaignId)))
        .for('update');
      if (!order || order.countryId !== country.id) throw new NotFoundException('Order not found');
      if (order.completesAt) throw new BadRequestException('That unit is already being built');
      const balance = await this.economy.settle(tx, country);
      await this.economy.writeBalance(tx, country.id, addResources(balance, UNITS[order.unitType].cost));
      await tx.delete(productionOrders).where(eq(productionOrders.id, order.id));
    });
    this.realtime.campaignUpdate(campaignId, { kind: 'production' });
    return { ok: true };
  }

  async listForProvince(provinceId: string): Promise<ProductionOrderDto[]> {
    const rows = await this.db
      .select()
      .from(productionOrders)
      .where(eq(productionOrders.provinceId, provinceId))
      .orderBy(asc(productionOrders.position));
    return rows.map(toOrderDto);
  }

  /** Scheduler hook: finishes units whose time has come and starts the next ones. */
  async processDue(): Promise<void> {
    const due = await this.db
      .selectDistinct({ provinceId: productionOrders.provinceId })
      .from(productionOrders)
      .where(and(isNotNull(productionOrders.completesAt), lte(productionOrders.completesAt, new Date())))
      .limit(100);
    for (const { provinceId } of due) {
      try {
        await this.processProvince(provinceId);
      } catch (err) {
        this.log.warn(`production ${provinceId}: ${(err as Error).message}`);
      }
    }
  }

  private async processProvince(provinceId: string) {
    const [province] = await this.db.select().from(provinces).where(eq(provinces.id, provinceId));
    if (!province) return;

    const notes = await this.economy.lock(province.ownerCountryId, async (tx, country) => {
      const rows = await tx
        .select()
        .from(productionOrders)
        .where(eq(productionOrders.provinceId, provinceId))
        .orderBy(asc(productionOrders.position))
        .for('update');

      // Orders placed by a previous owner are lost with the factory.
      const stale = rows.filter((r) => r.countryId !== country.id);
      if (stale.length) {
        await tx.delete(productionOrders).where(inArray(productionOrders.id, stale.map((r) => r.id)));
      }
      const queue = rows.filter((r) => r.countryId === country.id);

      const out = [];
      let guard = 0;
      let changed = false;
      while (queue.length > 0 && queue[0].completesAt && queue[0].completesAt.getTime() <= Date.now() && guard++ < 50) {
        const done = queue.shift()!;
        if (!changed) {
          // Settle once, before the new unit starts costing upkeep.
          await this.economy.settle(tx, country);
          changed = true;
        }
        await addToGarrison(tx, {
          campaignId: country.campaignId,
          countryId: country.id,
          provinceId,
          unitType: done.unitType,
          count: 1,
        });
        await tx.delete(productionOrders).where(eq(productionOrders.id, done.id));
        out.push(
          await this.notifications.add(tx, {
            campaignId: country.campaignId,
            countryId: country.id,
            type: 'unit_ready',
            message: `${UNITS[done.unitType].name} finished in ${province.name}.`,
          }),
        );
        const next = queue[0];
        if (next) {
          // The next unit starts when this one finished, not when the server noticed.
          const startedAt = done.completesAt!.getTime();
          next.completesAt = new Date(startedAt + duration(next.unitType));
          await tx.update(productionOrders).set({ completesAt: next.completesAt }).where(eq(productionOrders.id, next.id));
        }
      }
      return out;
    });

    for (const n of notes) this.notifications.publish(n);
    if (notes.length) this.realtime.campaignUpdate(province.campaignId, { kind: 'production', provinceId });
  }
}
