import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
  PROVINCE_BY_KEY,
  UNITS,
  canAfford,
  planAiWar,
  spend,
  unitPower,
  type Resources,
  type StackUnit,
  type UnitType,
} from '@cw/shared';
import type { DbOrTx } from '../db/db.module';
import { formationUnits, formations, provinces, type CountryRow } from '../db/schema';
import { addToGarrison } from '../military/garrison';
import { MovementService } from '../military/movement.service';
import { EconomyService } from '../economy/economy.service';
import { WarsService } from '../wars/wars.service';

/**
 * The AI's war phase, run inside its normal decision. It looks at the map, asks the pure planner
 * (`planAiWar`, tested in the shared package) what to do, and carries it out: emergency infantry
 * where the front is weak, and counterattacks with armies sent through the normal movement system.
 */
@Injectable()
export class AiWarService {
  private readonly log = new Logger(AiWarService.name);

  constructor(
    private readonly wars: WarsService,
    private readonly movement: MovementService,
    private readonly economy: EconomyService,
  ) {}

  async act(tx: DbOrTx, country: CountryRow, balance: Resources): Promise<{ balance: Resources; acted: boolean; atWar: boolean }> {
    const enemies = await this.wars.enemiesOf(tx, country.id);
    if (enemies.size === 0) return { balance, acted: false, atWar: false };

    const provs = await tx.select().from(provinces).where(eq(provinces.campaignId, country.campaignId));
    const keyById = new Map(provs.map((p) => [p.id, p.key]));
    const idByKey = new Map(provs.map((p) => [p.key, p.id]));
    const ownerByKey = new Map(provs.map((p) => [p.key, p.ownerCountryId]));

    // Every army of this country or its enemies.
    const involved = [country.id, ...enemies];
    const forms = await tx
      .select()
      .from(formations)
      .where(and(eq(formations.campaignId, country.campaignId), inArray(formations.countryId, involved)));
    const unitRows = forms.length
      ? await tx.select().from(formationUnits).where(inArray(formationUnits.formationId, forms.map((f) => f.id)))
      : [];
    const unitsOf = (fid: string): StackUnit[] =>
      unitRows.filter((u) => u.formationId === fid).map((u) => ({ unitType: u.unitType, count: u.count }));

    const ownUnits = new Map<string, StackUnit[]>();
    const enemyPower = new Map<string, number>();
    const threat = new Map<string, number>();
    const addThreat = (key: string, p: number) => {
      if (ownerByKey.get(key) === country.id) threat.set(key, (threat.get(key) ?? 0) + p);
    };

    for (const f of forms) {
      const key = keyById.get(f.provinceId);
      if (!key) continue;
      const all = unitsOf(f.id);
      const moving = !!f.moveArrivesAt && !!f.moveNextProvinceId;
      if (f.countryId === country.id) {
        if (moving) continue;
        const land = all.filter((u) => UNITS[u.unitType].category === 'land');
        if (land.length) ownUnits.set(key, [...(ownUnits.get(key) ?? []), ...land]);
        continue;
      }
      const power = unitPower(all);
      if (moving) {
        const dest = f.movePath.length ? f.movePath[f.movePath.length - 1] : f.moveNextProvinceId!;
        const destKey = keyById.get(dest);
        if (destKey) addThreat(destKey, power);
      } else {
        if (enemies.has(ownerByKey.get(key) ?? '')) enemyPower.set(key, (enemyPower.get(key) ?? 0) + power);
        for (const adj of PROVINCE_BY_KEY[key]?.roads ?? []) addThreat(adj, power);
      }
    }

    const plan = planAiWar({
      countryId: country.id,
      countryCode: country.code,
      ownerByKey,
      enemies,
      ownUnits,
      enemyPower,
      threat,
    });

    let acted = false;

    // --- emergency infantry ---
    const infantry = UNITS.infantry;
    for (const r of plan.recruit) {
      let n = r.infantry;
      while (n > 0 && !canAfford(balance, scaleCost(infantry.cost, n))) n--;
      if (n <= 0) continue;
      balance = spend(balance, scaleCost(infantry.cost, n));
      await addToGarrison(tx, {
        campaignId: country.campaignId,
        countryId: country.id,
        provinceId: idByKey.get(r.key)!,
        unitType: 'infantry',
        count: n,
      });
      acted = true;
    }
    await this.economy.writeBalance(tx, country.id, balance);

    // --- counterattacks ---
    for (const atk of plan.attacks) {
      try {
        const fromId = idByKey.get(atk.fromKey)!;
        const here = forms.filter((f) => f.provinceId === fromId && f.countryId === country.id && !f.moveArrivesAt);
        const source = here
          .map((f) => ({ f, power: unitPower(unitsOf(f.id)) }))
          .sort((a, b) => b.power - a.power)[0]?.f;
        if (!source) continue;
        const have = unitsOf(source.id);
        const send: Partial<Record<UnitType, number>> = {};
        for (const u of atk.send) {
          const n = Math.min(u.count, have.find((h) => h.unitType === u.unitType)?.count ?? 0);
          if (n > 0) send[u.unitType] = n;
        }
        if (Object.keys(send).length === 0) continue;
        await this.movement.orderFor(tx, country, country.campaignId, source.id, idByKey.get(atk.toKey)!, send);
        acted = true;
      } catch (err) {
        this.log.debug(`AI attack skipped: ${(err as Error).message}`);
      }
    }
    return { balance, acted, atWar: true };
  }
}

function scaleCost(cost: Partial<Record<keyof Resources, number>>, n: number) {
  const out: Partial<Record<keyof Resources, number>> = {};
  for (const [k, v] of Object.entries(cost)) out[k as keyof Resources] = (v ?? 0) * n;
  return out;
}
