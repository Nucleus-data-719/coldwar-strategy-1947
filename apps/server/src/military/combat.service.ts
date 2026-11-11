import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import {
  CAPITAL_LOOT_SHARE,
  CAPITAL_STABILITY_LOSS,
  OCCUPATION_DISRUPTION_SECONDS,
  CAPITAL_DEFENSE,
  explainBattle,
  airModifiers,
  canOccupyLand,
  generalModifiers,
  GENERAL_XP_LOSS,
  GENERAL_XP_WALKOVER,
  GENERAL_XP_WIN,
  hashSeed,
  resolveBattle,
  shortagesOf,
  supplyPenalty,
  type BattleReportDto,
  type BattleSideReport,
  type CombatUnit,
  type Resources,
  type UnitType,
} from '@cw/shared';
import { env } from '../config/env';
import { DB, Db, DbOrTx } from '../db/db.module';
import {
  battleReports,
  buildings,
  BattleReportRow,
  countries,
  CountryRow,
  formationUnits,
  FormationRow,
  FormationUnitRow,
  formations,
  NotificationRow,
  ProvinceRow,
  provinces,
} from '../db/schema';
import { loadResearch } from '../research/research.queries';
import { deployedIn, settleGenerals, toDeployed } from '../generals/generals.queries';
import { EconomyService } from '../economy/economy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlayersService } from '../players/players.service';

export interface AttackOutcome {
  won: boolean;
  /** False when the attackers won but have no land units to occupy the province. */
  captured: boolean;
  /** What is left of the attacking army (empty if it was destroyed). */
  attackerUnits: CombatUnit[];
  notes: NotificationRow[];
}

function tally(rows: { unitType: UnitType; count: number }[]): CombatUnit[] {
  const by = new Map<UnitType, number>();
  for (const r of rows) by.set(r.unitType, (by.get(r.unitType) ?? 0) + r.count);
  return [...by.entries()].filter(([, n]) => n > 0).map(([unitType, count]) => ({ unitType, count }));
}

export function toReportDto(row: BattleReportRow): BattleReportDto {
  return { ...row.data, id: row.id, createdAt: row.createdAt.toISOString(), outcome: row.outcome };
}

/**
 * Resolves what happens when an army reaches an enemy province: the battle, the report,
 * capture of the province and, if it was a capital, the loot and the move of the capital.
 */
@Injectable()
export class CombatService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly economy: EconomyService,
    private readonly notifications: NotificationsService,
    private readonly players: PlayersService,
  ) {}

  /**
   * Must run inside `economy.lockMany` with both countries locked. Both are settled first, because
   * capturing a province and losing units change their hourly rates.
   */
  async resolveAttack(
    tx: DbOrTx,
    a: {
      formation: FormationRow;
      units: FormationUnitRow[];
      attacker: CountryRow;
      defender: CountryRow;
      province: ProvinceRow;
      arrivedAt: number;
    },
  ): Promise<AttackOutcome> {
    const { formation, attacker, defender, province } = a;

    let attackerBalance = await this.economy.settle(tx, attacker);
    let defenderBalance = await this.economy.settle(tx, defender);

    // Defenders: every standing army of the province owner that is sitting in the province.
    const defFormations = await tx
      .select()
      .from(formations)
      .where(
        and(eq(formations.provinceId, province.id), eq(formations.countryId, defender.id), isNull(formations.moveArrivesAt), isNull(formations.seaNode)),
      );
    const defUnitRows = defFormations.length
      ? await tx
          .select()
          .from(formationUnits)
          .where(inArray(formationUnits.formationId, defFormations.map((f) => f.id)))
      : [];

    const [fort] = await tx
      .select({ id: buildings.id })
      .from(buildings)
      .where(and(eq(buildings.provinceId, province.id), eq(buildings.type, 'fortress'), eq(buildings.status, 'complete')));

    // Out of oil, food or money while still using it up costs a side attack and defence.
    const supplyMods = async (c: CountryRow, balance: Resources, side: 'attacker' | 'defender') =>
      supplyPenalty(shortagesOf(balance, await this.economy.computeRates(tx, c.id))).map((m) => ({ side, ...m }));

    const researchMods = async (c: CountryRow, side: 'attacker' | 'defender') => {
      const pct = (await loadResearch(tx, c.id)).summary.combatPercent;
      return pct > 0 ? [{ side, label: 'Research', percent: pct }] : [];
    };

    // Generals leading the armies in this battle (read before any army is destroyed).
    const attGenerals = await deployedIn(tx, [formation.id]);
    const defGenerals = await deployedIn(tx, defFormations.map((f) => f.id));
    const defUnitsOf = (fid: string) => tally(defUnitRows.filter((u) => u.formationId === fid));
    const attackerBefore = tally(a.units);
    const defenderBefore = tally(defUnitRows);
    const walkover = defenderBefore.length === 0;
    const result = resolveBattle({
      seed: hashSeed(`${formation.id}|${province.id}|${a.arrivedAt}`),
      attackerUnits: attackerBefore,
      defenderUnits: defenderBefore,
      terrain: province.terrain,
      fortress: !!fort,
      provinceDefense: province.defense,
      attackerModifiers: [
        ...(await researchMods(attacker, 'attacker')),
        ...airModifiers('attacker', attackerBefore, defenderBefore),
        ...generalModifiers('attacker', attGenerals.map((g) => toDeployed(g, attackerBefore)), a.arrivedAt),
        ...(await supplyMods(attacker, attackerBalance, 'attacker')),
      ],
      defenderModifiers: [
        ...(await researchMods(defender, 'defender')),
        ...airModifiers('defender', defenderBefore, attackerBefore),
        ...generalModifiers('defender', defGenerals.map((g) => toDeployed(g, defUnitsOf(g.deployedFormationId!))), a.arrivedAt),
        ...(await supplyMods(defender, defenderBalance, 'defender')),
      ],
    });
    const won = result.outcome === 'attacker_won';
    const captured = won && canOccupyLand(attackerBefore);

    // --- apply losses ---------------------------------------------------------------------
    if (won) {
      const after = new Map(result.attackerAfter.map((u) => [u.unitType, u.count]));
      for (const row of a.units) {
        const left = after.get(row.unitType) ?? 0;
        if (left <= 0) await tx.delete(formationUnits).where(eq(formationUnits.id, row.id));
        else if (left !== row.count) await tx.update(formationUnits).set({ count: left }).where(eq(formationUnits.id, row.id));
      }
    } else {
      await tx.delete(formations).where(eq(formations.id, formation.id)); // units cascade
    }

    const defAfter = new Map(result.defenderAfter.map((u) => [u.unitType, u.count]));
    const lossByType = new Map<UnitType, number>();
    for (const u of defenderBefore) lossByType.set(u.unitType, u.count - (defAfter.get(u.unitType) ?? 0));
    for (const row of defUnitRows) {
      const loss = Math.min(row.count, lossByType.get(row.unitType) ?? 0);
      if (loss <= 0) continue;
      lossByType.set(row.unitType, (lossByType.get(row.unitType) ?? 0) - loss);
      if (loss >= row.count) await tx.delete(formationUnits).where(eq(formationUnits.id, row.id));
      else await tx.update(formationUnits).set({ count: row.count - loss }).where(eq(formationUnits.id, row.id));
    }
    for (const f of defFormations) {
      const left = await tx.select({ id: formationUnits.id }).from(formationUnits).where(eq(formationUnits.formationId, f.id));
      if (left.length === 0) await tx.delete(formations).where(eq(formations.id, f.id));
    }

    // --- generals: experience, and a 24 hour lock for one whose army was destroyed ------------
    const aftermath = await settleGenerals(
      tx,
      [
        ...attGenerals.map((row) => ({ row, countryId: attacker.id, won, destroyed: !won })),
        ...defGenerals.map((row) => ({ row, countryId: defender.id, won: !won, destroyed: won })),
      ],
      { win: walkover ? GENERAL_XP_WALKOVER : GENERAL_XP_WIN, loss: GENERAL_XP_LOSS },
      Date.now(),
    );

    // --- capture --------------------------------------------------------------------------
    let capturedCapital = false;
    const summary = walkover
      ? [`${province.name} had no defenders and was taken without a fight.`]
      : explainBattle(result);
    if (won && !captured) {
      summary.push(
        `${attacker.name}'s ships and aircraft destroyed the defenders of ${province.name} but cannot occupy land without ground troops.`,
      );
    }
    if (captured) {
      const until = new Date(a.arrivedAt + (OCCUPATION_DISRUPTION_SECONDS / env.GAME_SPEED) * 1000);
      await tx
        .update(provinces)
        .set({ ownerCountryId: attacker.id, disruptedUntil: until })
        .where(eq(provinces.id, province.id));
      summary.push(
        `${attacker.name} captured ${province.name}. It produces nothing while the occupation settles in.`,
      );

      if (defender.capitalProvinceId === province.id) {
        capturedCapital = true;
        const remaining = { ...defenderBalance };
        const gained = { ...attackerBalance };
        for (const key of Object.keys(remaining) as (keyof Resources)[]) {
          const taken = Math.floor(defenderBalance[key] * CAPITAL_LOOT_SHARE);
          remaining[key] -= taken;
          gained[key] += taken;
        }
        defenderBalance = remaining;
        attackerBalance = gained;
        const [next] = await tx
          .select({ id: provinces.id })
          .from(provinces)
          .where(and(eq(provinces.ownerCountryId, defender.id), ne(provinces.id, province.id)))
          .orderBy(provinces.key)
          .limit(1);
        if (next) await tx.update(provinces).set({ defense: CAPITAL_DEFENSE }).where(eq(provinces.id, next.id));
        await tx
          .update(countries)
          .set({ capitalProvinceId: next?.id ?? null, stability: Math.max(0, defender.stability - CAPITAL_STABILITY_LOSS) })
          .where(eq(countries.id, defender.id));
        summary.push(
          `${defender.name} lost its capital: ${Math.round(CAPITAL_LOOT_SHARE * 100)}% of its stockpile was seized and stability fell by ${CAPITAL_STABILITY_LOSS}.`,
        );
      }
    }
    await this.economy.writeBalance(tx, attacker.id, attackerBalance);
    await this.economy.writeBalance(tx, defender.id, defenderBalance);

    // --- report ---------------------------------------------------------------------------
    const side = (c: CountryRow, names: string[], before: CombatUnit[], after: CombatUnit[]): BattleSideReport => ({
      countryId: c.id,
      countryName: c.name,
      formations: names,
      before,
      after,
    });
    await tx
      .insert(battleReports)
      .values({
        campaignId: attacker.campaignId,
        attackerId: attacker.id,
        defenderId: defender.id,
        outcome: walkover ? 'walkover' : result.outcome,
        data: {
          provinceKey: province.key,
          provinceName: province.name,
          terrain: province.terrain,
          seed: hashSeed(`${formation.id}|${province.id}|${a.arrivedAt}`),
          attacker: side(attacker, [formation.name], attackerBefore, result.attackerAfter),
          defender: side(defender, defFormations.map((f) => f.name), defenderBefore, result.defenderAfter),
          modifiers: result.modifiers,
          rounds: result.rounds,
          summary,
          capturedProvince: captured,
          capturedCapital,
          attackerFate: captured ? 'advanced' : won ? 'retreated' : 'destroyed',
        },
      });

    const notes: NotificationRow[] = [];
    notes.push(
      await this.notifications.add(tx, {
        campaignId: attacker.campaignId,
        countryId: attacker.id,
        type: won ? 'battle_won' : 'battle_lost',
        message: won
          ? captured
            ? `${formation.name} captured ${province.name} from ${defender.name}.`
            : `${formation.name} destroyed the defenders of ${province.name} but cannot occupy it without land troops.`
          : `${formation.name} was destroyed attacking ${province.name}.`,
      }),
      await this.notifications.add(tx, {
        campaignId: attacker.campaignId,
        countryId: defender.id,
        type: captured ? 'province_lost' : won ? 'battle_lost' : 'battle_held',
        message: won
          ? captured
            ? `${attacker.name} captured ${province.name}${capturedCapital ? ', your capital' : ''}!`
            : `${attacker.name}'s ships and aircraft destroyed your forces in ${province.name}. The province is still yours.`
          : `Your forces held ${province.name} against ${attacker.name}.`,
      }),
    );
    for (const n of aftermath.notes) {
      notes.push(await this.notifications.add(tx, { campaignId: attacker.campaignId, ...n }));
    }
    return { won, captured, attackerUnits: result.attackerAfter, notes };
  }

  /** The most recent battles your country took part in. */
  async listReports(userId: string, campaignId: string): Promise<BattleReportDto[]> {
    const player = await this.players.require(userId, campaignId);
    const rows = await this.db
      .select()
      .from(battleReports)
      .where(or(eq(battleReports.attackerId, player.countryId), eq(battleReports.defenderId, player.countryId)))
      .orderBy(desc(battleReports.createdAt))
      .limit(30);
    return rows.map(toReportDto);
  }

  async getReport(userId: string, campaignId: string, reportId: string): Promise<BattleReportDto> {
    const player = await this.players.require(userId, campaignId);
    const [row] = await this.db
      .select()
      .from(battleReports)
      .where(and(eq(battleReports.id, reportId), eq(battleReports.campaignId, campaignId)));
    if (!row || (row.attackerId !== player.countryId && row.defenderId !== player.countryId)) {
      throw new NotFoundException('Battle report not found');
    }
    return toReportDto(row);
  }
}
