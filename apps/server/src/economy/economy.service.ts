import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import {
  BUILDING_KNOCKED_OUT,
  addResources,
  applyRates,
  emptyResources,
  provinceProduction,
  shortagesOf,
  subtractResources,
  unitUpkeepPerHour,
  type BuildingLike,
  INDUSTRIAL_RESOURCES,
  type RateBreakdown,
  type ResourceKey,
  type Resources,
} from '@cw/shared';
import { env } from '../config/env';
import { DB, Db, DbOrTx } from '../db/db.module';
import { loadResearch } from '../research/research.queries';
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
    return (await this.computeBreakdown(db, countryId)).net;
  }

  /** The hourly rates split into the parts that explain them, for the numbers shown in the top bar. */
  async computeBreakdown(db: DbOrTx, countryId: string): Promise<RateBreakdown> {
    const allOwned = await db.select().from(provinces).where(eq(provinces.ownerCountryId, countryId));
    // A freshly captured province produces nothing until its disruption ends.
    const owned = allOwned.filter((p) => !p.disruptedUntil);
    let provincesBase = emptyResources();
    let withBuildings = emptyResources();

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
        // A building bombed past the limit stops working until repaired.
        list.push({ type: b.type, status: b.status === 'complete' && b.damage >= BUILDING_KNOCKED_OUT ? 'constructing' : b.status });
        byProvince.set(b.provinceId, list);
      }
      for (const p of owned) {
        provincesBase = addResources(provincesBase, p.production);
        withBuildings = addResources(withBuildings, provinceProduction(p.production, byProvince.get(p.id) ?? []));
      }
    }
    const buildingBonus = subtractResources(withBuildings, provincesBase);

    // Research: industry techs raise industrial output (money and strategic resources), not food or manpower.
    const bonus = (await loadResearch(db, countryId)).summary.productionPercent;
    const researchBonus = emptyResources();
    if (bonus > 0) for (const k of INDUSTRIAL_RESOURCES) researchBonus[k] = withBuildings[k] * (bonus / 100);

    const units = await db
      .select({ unitType: formationUnits.unitType, count: formationUnits.count })
      .from(formationUnits)
      .innerJoin(formations, eq(formations.id, formationUnits.formationId))
      .where(eq(formations.countryId, countryId));
    const upkeep = unitUpkeepPerHour(units);

    const net = subtractResources(addResources(withBuildings, researchBonus), upkeep);
    return {
      provinces: provincesBase,
      buildings: buildingBonus,
      research: researchBonus,
      upkeep,
      provinceCount: owned.length,
      disruptedCount: allOwned.length - owned.length,
      researchPercent: bonus,
      net,
    };
  }

  /** Current balance and rates without writing anything. */
  async getLive(
    countryId: string,
  ): Promise<{ balance: Resources; rates: Resources; shortages: ResourceKey[]; breakdown: RateBreakdown }> {
    const [country] = await this.db.select().from(countries).where(eq(countries.id, countryId));
    if (!country) throw new NotFoundException('Country not found');
    const breakdown = await this.computeBreakdown(this.db, countryId);
    const rates = breakdown.net;
    const elapsed = ((Date.now() - country.resourcesUpdatedAt.getTime()) / 1000) * env.GAME_SPEED;
    const balance = applyRates(rowToResources(country), rates, elapsed);
    return { balance, rates, shortages: shortagesOf(balance, rates), breakdown };
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

  /**
   * Like `lock`, for actions that touch several countries (a battle). Rows are locked in id order
   * so two battles at once cannot deadlock.
   */
  async lockMany<T>(
    countryIds: string[],
    fn: (tx: DbOrTx, countryRows: Map<string, CountryRow>) => Promise<T>,
  ): Promise<T> {
    const sorted = [...new Set(countryIds)].sort();
    return this.db.transaction(async (tx) => {
      const rows = new Map<string, CountryRow>();
      for (const id of sorted) {
        const [country] = await tx.select().from(countries).where(eq(countries.id, id)).for('update');
        if (!country) throw new NotFoundException('Country not found');
        rows.set(id, country);
      }
      return fn(tx, rows);
    });
  }
}
