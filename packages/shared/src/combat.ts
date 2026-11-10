import { BUILDINGS } from './game-data/buildings';
import { UNITS } from './game-data/units';
import type { Terrain, UnitType } from './types';

/** Extra defence for the defender, by the terrain of the province under attack. */
export const TERRAIN_DEFENSE_BONUS: Record<Terrain, number> = {
  plains: 0,
  forest: 0.15,
  hills: 0.25,
  mountains: 0.4,
  desert: 0.05,
};

/**
 * Tuned by simulation (see the combat tests).
 * intensity: how quickly a battle burns through both armies.
 * luck: spread of the fixed per-battle luck factor (0.5 means each side gets 0.75 to 1.25).
 */
export const TUNING = { intensity: 1.5, luck: 0.5 };
export const MAX_BATTLE_ROUNDS = 40;
/** A side whose remaining strength falls below this share of its start breaks and is destroyed. */
export const BREAK_SHARE = 0.1;
const ROLL_MIN = 0.85;
const ROLL_SPREAD = 0.3;

/** Small deterministic hash so a battle's seed can be rebuilt from its inputs. */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CombatUnit {
  unitType: UnitType;
  count: number;
}

export interface BattleInput {
  seed: number;
  attackerUnits: CombatUnit[];
  defenderUnits: CombatUnit[];
  terrain: Terrain;
  fortress: boolean;
  /** Province defence value. Each point adds 1% to the defenders' defence. */
  provinceDefense: number;
  /** Extra modifiers such as an out-of-supply penalty (negative percent). */
  attackerModifiers?: BattleModifier[];
  defenderModifiers?: BattleModifier[];
}

export interface BattleModifier {
  side: 'attacker' | 'defender';
  label: string;
  percent: number;
}

export interface BattleRoundLog {
  round: number;
  /** Strength each side has left after the round, as a percentage of its start. */
  attackerPct: number;
  defenderPct: number;
}

export interface BattleStart {
  attackerAttack: number;
  attackerDefence: number;
  defenderAttack: number;
  defenderDefence: number;
}

export interface BattleResult {
  outcome: 'attacker_won' | 'defender_held';
  attackerAfter: CombatUnit[];
  defenderAfter: CombatUnit[];
  rounds: BattleRoundLog[];
  modifiers: BattleModifier[];
  start: BattleStart;
  attackerLossPct: number;
  defenderLossPct: number;
  /** True when neither side broke within the round limit. */
  timedOut: boolean;
}

function totals(units: CombatUnit[], bonus: number) {
  let hp = 0;
  let attack = 0;
  let defence = 0;
  for (const u of units) {
    const d = UNITS[u.unitType];
    hp += u.count * d.health;
    attack += u.count * d.attack;
    defence += u.count * d.defense;
  }
  // A defender's bonuses lift both its defence and its counter-attack.
  const factor = Math.max(0.2, 1 + bonus);
  return { hp, attack: attack * factor, defence: defence * factor };
}

/** Share of an attack that gets through the enemy's defence. 0.5 when attack equals defence. */
function hitShare(attack: number, enemyDefence: number): number {
  if (attack <= 0) return 0;
  return attack / (attack + enemyDefence);
}

function survivors(units: CombatUnit[], share: number, broken: boolean): CombatUnit[] {
  if (broken) return [];
  const out = units
    .map((u) => ({ unitType: u.unitType, count: Math.round(u.count * share) }))
    .filter((u) => u.count > 0);
  if (out.length === 0 && units.length > 0) {
    const biggest = [...units].sort((a, b) => b.count - a.count)[0];
    out.push({ unitType: biggest.unitType, count: 1 });
  }
  return out;
}

/**
 * Automated battle, fought in rounds. Each round both sides inflict damage at the same time:
 *
 *   damage = intensity x roll x attack x attack / (attack + enemy defence)
 *
 * so a bigger force gains more than its raw numbers (concentration matters) and defence
 * soaks up a share of what the enemy brings. Defenders' terrain, fortress and local-defence
 * bonuses lift both their defence and their counter-attack. `roll` is a seeded random 0.85 to
 * 1.15 each round, plus one fixed luck factor per side for the whole battle, so a battle can
 * always be replayed from its seed. A side below 10% of its start strength breaks and is destroyed.
 */
export function resolveBattle(input: BattleInput): BattleResult {
  const rand = seededRandom(input.seed);

  const modifiers: BattleModifier[] = [];
  const terrainBonus = TERRAIN_DEFENSE_BONUS[input.terrain];
  if (terrainBonus > 0) modifiers.push({ side: 'defender', label: `Terrain: ${input.terrain}`, percent: terrainBonus * 100 });
  if (input.fortress) {
    modifiers.push({ side: 'defender', label: 'Fortress', percent: BUILDINGS.fortress.defenseBonus ?? 0 });
  }
  if (input.provinceDefense > 0) modifiers.push({ side: 'defender', label: 'Local defences', percent: input.provinceDefense });
  modifiers.push(...(input.attackerModifiers ?? []), ...(input.defenderModifiers ?? []));
  const sideBonus = (side: BattleModifier['side']) =>
    modifiers.filter((m) => m.side === side).reduce((sum, m) => sum + m.percent, 0) / 100;
  const defenderBonus = sideBonus('defender');
  const attackerBonus = sideBonus('attacker');

  const att = totals(input.attackerUnits, attackerBonus);
  const def = totals(input.defenderUnits, defenderBonus);
  const start: BattleStart = {
    attackerAttack: att.attack,
    attackerDefence: att.defence,
    defenderAttack: def.attack,
    defenderDefence: def.defence,
  };

  // Each side also gets one fixed "luck" factor for the whole battle (morale, local surprise),
  // so close fights stay uncertain instead of being decided by round-to-round averages.
  const luckA = 1 - TUNING.luck / 2 + rand() * TUNING.luck;
  const luckD = 1 - TUNING.luck / 2 + rand() * TUNING.luck;

  // Nothing to fight with on one side: no rounds are needed.
  if (def.hp <= 0 || att.hp <= 0) {
    const attackerWins = def.hp <= 0 && att.hp > 0;
    return {
      outcome: attackerWins ? 'attacker_won' : 'defender_held',
      attackerAfter: attackerWins ? input.attackerUnits : [],
      defenderAfter: attackerWins ? [] : input.defenderUnits,
      rounds: [],
      modifiers,
      start,
      attackerLossPct: attackerWins ? 0 : 100,
      defenderLossPct: attackerWins ? 100 : 0,
      timedOut: false,
    };
  }

  let attShare = 1;
  let defShare = 1;
  const rounds: BattleRoundLog[] = [];

  for (let round = 1; round <= MAX_BATTLE_ROUNDS; round++) {
    // Strength left shrinks as units die, which weakens a side's next round.
    const aAtk = att.attack * attShare * luckA;
    const aDef = att.defence * attShare;
    const dAtk = def.attack * defShare * luckD;
    const dDef = def.defence * defShare;
    const rollA = ROLL_MIN + rand() * ROLL_SPREAD;
    const rollD = ROLL_MIN + rand() * ROLL_SPREAD;

    const damageToDefender = TUNING.intensity * rollA * aAtk * hitShare(aAtk, dDef);
    const damageToAttacker = TUNING.intensity * rollD * dAtk * hitShare(dAtk, aDef);

    defShare = Math.max(0, defShare - damageToDefender / def.hp);
    attShare = Math.max(0, attShare - damageToAttacker / att.hp);
    rounds.push({ round, attackerPct: Math.round(attShare * 100), defenderPct: Math.round(defShare * 100) });
    if (attShare < BREAK_SHARE || defShare < BREAK_SHARE) break;
  }

  const attBroken = attShare < BREAK_SHARE;
  const defBroken = defShare < BREAK_SHARE;
  return {
    outcome: defBroken && !attBroken ? 'attacker_won' : 'defender_held',
    attackerAfter: survivors(input.attackerUnits, attShare, attBroken),
    defenderAfter: survivors(input.defenderUnits, defShare, defBroken),
    rounds,
    modifiers,
    start,
    attackerLossPct: Math.round((1 - attShare) * 100),
    defenderLossPct: Math.round((1 - defShare) * 100),
    timedOut: !attBroken && !defBroken,
  };
}

/** Plain-language reasons for the result, shown in the battle report. */
export function explainBattle(r: BattleResult): string[] {
  const s = r.start;
  const lines: string[] = [];
  lines.push(
    `Attackers brought ${Math.round(s.attackerAttack)} attack against the defenders' ${Math.round(s.defenderDefence)} defence. ` +
      `Defenders brought ${Math.round(s.defenderAttack)} attack against the attackers' ${Math.round(s.attackerDefence)} defence.`,
  );
  const describe = (side: BattleModifier['side'], who: string) => {
    const mods = r.modifiers.filter((m) => m.side === side);
    if (mods.length === 0) return null;
    const total = Math.round(mods.reduce((sum, m) => sum + m.percent, 0));
    const fmt = (p: number) => `${p >= 0 ? '+' : ''}${Math.round(p)}%`;
    return `${who} ${total >= 0 ? 'gained' : 'suffered'} ${fmt(total)} attack and defence: ${mods
      .map((m) => `${m.label} (${fmt(m.percent)})`)
      .join(', ')}.`;
  };
  const modLines = [describe('attacker', 'Attackers'), describe('defender', 'Defenders')].filter((l): l is string => !!l);
  if (modLines.length > 0) lines.push(...modLines);
  else lines.push('Neither side had a terrain, fortress, local-defence or supply modifier.');
  const n = r.rounds.length;
  if (r.outcome === 'attacker_won') {
    lines.push(`The defenders broke after ${n} rounds. Attackers lost ${r.attackerLossPct}% of their strength, defenders ${r.defenderLossPct}%.`);
  } else if (r.timedOut) {
    lines.push(`Neither side broke in ${n} rounds, so the defenders kept the province. Attackers lost ${r.attackerLossPct}%, defenders ${r.defenderLossPct}%.`);
  } else if (r.attackerAfter.length === 0 && r.defenderAfter.length === 0) {
    lines.push(`Both sides were destroyed in ${n} rounds. The province stays with its owner.`);
  } else {
    lines.push(`The attackers broke after ${n} rounds. Attackers lost ${r.attackerLossPct}% of their strength, defenders ${r.defenderLossPct}%.`);
  }
  return lines;
}
