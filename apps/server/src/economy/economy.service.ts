import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import {
  addResources,
  applyRates,
  emptyResources,
  provinceProduction,
  subtractResources,
  unitUpkeepPerHour,
  type BuildingLike,
  type Resources,
} from '@cw/shared';
import { env } from '../config/env';
import { DB, Db, DbOrTx } from '../db/db.module';
import { buildings, countries, CountryRow, formationUnits, formations, provinces } from '../db/schema';

export function rowToResources(row: CountryRow): Resources {
  return {
    money: row.money,
    food: row.food,
    oil: row.oil,
    steel: row.steel,
    electronics: row.electronics,
    rare: row.rare,
    manpower: row.manpower,
  };
}

/**
 * Resources are calculated lazily: a country stores its balance and the time it was
 * last settled. Production and upkeep rates are derived from provinces, buildings and
 * units. Whenever something changes those rates, the country is settled first.
 */
@Injectable()
export class EconomyService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Hourly net production (production minus unit upkeep). Can be negative. */
  async computeRates(db: DbOrTx, countryId: string): Promise<Resources> {
    const owned = await db.select().from(provinces).where(eq(provinces.ownerCountryId, countryId));
    let total = emptyResources();

    if (owned.length > 0) {
      const blds = await db
        .select()
        .from(buildings)
        .where(
          inArray(
            buildings.provinceId,
            owned.map((p) => p.id),
          ),
        );
      const byProvince = new Map<string, BuildingLike[]>();
      for (const b of blds) {
        const list = byProvince.get(b.provinceId) ?? [];
        list.push({ type: b.type, status: b.status });
        byProvince.set(b.provinceId, list);
      }
      for (const p of owned) {
        total = addResources(total, provinceProduction(p.production, byProvince.get(p.id) ?? []));
      }
    }

    const units = await db
      .select({ unitType: formationUnits.unitType, count: formationUnits.count })
      .from(formationUnits)
      .innerJoin(formations, eq(formations.id, formationUnits.formationId))
      .where(eq(formations.countryId, countryId));

    return subtractResources(total, unitUpkeepPerHour(units));
  }

  /** Current balance and rates without writing anything. */
  async getLive(countryId: string): Promise<{ balance: Resources; rates: Resources }> {
    const [country] = await this.db.select().from(countries).where(eq(countries.id, countryId));
    if (!country) throw new NotFoundException('Country not found');
    const rates = await this.computeRates(this.db, countryId);
    const elapsed = ((Date.now() - country.resourcesUpdatedAt.getTime()) / 1000) * env.GAME_SPEED;
    return { balance: applyRates(rowToResources(country), rates, elapsed), rates };
  }

  /** Brings the stored balance up to date. Call inside `lock`, before anything changes the rates. */
  async settle(tx: DbOrTx, country: CountryRow): Promise<Resources> {
    const now = new Date();
    const elapsed = Math.max(0, (now.getTime() - country.resourcesUpdatedAt.getTime()) / 1000) * env.GAME_SPEED;
    const rates = await this.computeRates(tx, country.id);
    const balance = applyRates(rowToResources(country), rates, elapsed);
    await tx
      .update(countries)
      .set({ ...balance, resourcesUpdatedAt: now })
      .where(eq(countries.id, country.id));
    return balance;
  }

  async writeBalance(tx: DbOrTx, countryId: string, balance: Resources): Promise<void> {
    await tx.update(countries).set({ ...balance }).where(eq(countries.id, countryId));
  }

  /** Runs `fn` in a transaction holding a row lock on the country, so spending cannot race. */
  async lock<T>(countryId: string, fn: (tx: DbOrTx, country: CountryRow) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const [country] = await tx.select().from(countries).where(eq(countries.id, countryId)).for('update');
      if (!country) throw new NotFoundException('Country not found');
      return fn(tx, country);
    });
  }
}
