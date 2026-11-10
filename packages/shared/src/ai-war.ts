import { UNITS } from './game-data/units';
import { PROVINCE_BY_KEY } from './map-data';
import type { UnitType } from './types';

export interface StackUnit {
  unitType: UnitType;
  count: number;
}

/** Rough fighting value of some units. Used by the AI only. */
export function unitPower(units: StackUnit[]): number {
  let p = 0;
  for (const u of units) {
    const d = UNITS[u.unitType];
    p += ((d.attack + d.defense) / 2) * (d.health / 100) * u.count;
  }
  return p;
}

export const INFANTRY_POWER = unitPower([{ unitType: 'infantry', count: 1 }]);
/** The AI attacks when it sends at least this many times the defender's power. */
export const AI_ATTACK_RATIO = 1.5;
/** Power the AI always leaves behind in a province it attacks from (two infantry). */
export const AI_KEEP_POWER = 2 * INFANTRY_POWER;
export const AI_MAX_ATTACKS = 2;
/** Emergency recruitment limits per decision. */
export const AI_RECRUIT_PER_PROVINCE = 4;
export const AI_RECRUIT_TOTAL = 8;
/** The AI wants this much more defence than the threat it sees. */
export const AI_DEFENCE_MARGIN = 1.25;
/** The AI will not mass more than this much extra power (about 30 infantry) to retake one province. */
export const AI_BUILDUP_LIMIT = 30 * INFANTRY_POWER;

export interface AiWarInput {
  countryId: string;
  /** Map country code of the AI country, to recognise its home provinces. */
  countryCode: string;
  ownerByKey: ReadonlyMap<string, string>;
  enemies: ReadonlySet<string>;
  /** Land units standing in each province the AI owns. */
  ownUnits: ReadonlyMap<string, StackUnit[]>;
  /** Defending power in provinces owned by an enemy. */
  enemyPower: ReadonlyMap<string, number>;
  /** Enemy power that is in, or on its way to, each province the AI owns. */
  threat: ReadonlyMap<string, number>;
}

export interface AiAttack {
  fromKey: string;
  toKey: string;
  send: StackUnit[];
}

export interface AiWarPlan {
  attacks: AiAttack[];
  recruit: { key: string; infantry: number }[];
}

/** What to send from a stack so that `keep` power stays behind. */
export function unitsToSend(units: StackUnit[], keep: number): StackUnit[] {
  const total = unitPower(units);
  if (total <= keep) return [];
  const share = (total - keep) / total;
  return units.map((u) => ({ unitType: u.unitType, count: Math.floor(u.count * share) })).filter((u) => u.count > 0);
}

/**
 * The AI's wartime brain, as a pure function so it can be tested.
 * 1. Defence: a province with less power than the threat near it gets emergency infantry.
 *    Build-up: the same for a province next to a lost home province, until a counterattack is possible.
 * 2. Counterattack: a province with a clearly stronger stack attacks an adjacent enemy-held province,
 *    home provinces first, then the weakest target. An undefended province is simply walked into.
 */
export function planAiWar(i: AiWarInput): AiWarPlan {
  const plan: AiWarPlan = { attacks: [], recruit: [] };
  if (i.enemies.size === 0) return plan;

  const ownPower = (key: string) => unitPower(i.ownUnits.get(key) ?? []);

  // --- defence and build-up ---
  const wanted = new Map<string, number>(); // province -> power deficit
  const want = (key: string, deficit: number) => {
    if (deficit > 0) wanted.set(key, Math.max(wanted.get(key) ?? 0, deficit));
  };
  for (const [key, threat] of i.threat) {
    if (i.ownerByKey.get(key) !== i.countryId || threat <= 0) continue;
    want(key, threat * AI_DEFENCE_MARGIN - ownPower(key));
  }
  // To retake a lost home province the AI first masses enough troops next to it.
  for (const [key, owner] of i.ownerByKey) {
    if (owner !== i.countryId) continue;
    for (const toKey of PROVINCE_BY_KEY[key]?.adjacent ?? []) {
      const foe = i.ownerByKey.get(toKey);
      if (!foe || !i.enemies.has(foe) || PROVINCE_BY_KEY[toKey]?.countryCode !== i.countryCode) continue;
      const defence = i.enemyPower.get(toKey) ?? 0;
      const target = defence > 0 ? AI_ATTACK_RATIO * defence + AI_KEEP_POWER : 0;
      const deficit = target - ownPower(key);
      if (deficit > 0 && deficit <= AI_BUILDUP_LIMIT) want(key, deficit);
    }
  }
  const needs = [...wanted.entries()]
    .map(([key, deficit]) => ({ key, deficit, infantry: Math.min(AI_RECRUIT_PER_PROVINCE, Math.ceil(deficit / INFANTRY_POWER)) }))
    .sort((a, b) => b.deficit - a.deficit);
  let budget = AI_RECRUIT_TOTAL;
  for (const n of needs) {
    if (budget <= 0) break;
    const take = Math.min(n.infantry, budget);
    plan.recruit.push({ key: n.key, infantry: take });
    budget -= take;
  }

  // --- counterattack ---
  const candidates: { fromKey: string; toKey: string; score: number; send: StackUnit[] }[] = [];
  for (const [fromKey, units] of i.ownUnits) {
    if (i.ownerByKey.get(fromKey) !== i.countryId) continue;
    const power = unitPower(units);
    if ((i.threat.get(fromKey) ?? 0) > 0.6 * power) continue; // needed at home
    const send = unitsToSend(units, AI_KEEP_POWER);
    const sendPower = unitPower(send);
    if (sendPower <= 0) continue;
    for (const toKey of PROVINCE_BY_KEY[fromKey]?.adjacent ?? []) {
      const owner = i.ownerByKey.get(toKey);
      if (!owner || !i.enemies.has(owner)) continue;
      const defence = i.enemyPower.get(toKey) ?? 0;
      if (defence > 0 && sendPower < AI_ATTACK_RATIO * defence) continue;
      const home = PROVINCE_BY_KEY[toKey]?.countryCode === i.countryCode ? 1000 : 0;
      candidates.push({ fromKey, toKey, send, score: home - defence });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  for (const c of candidates) {
    if (plan.attacks.length >= AI_MAX_ATTACKS) break;
    if (usedFrom.has(c.fromKey) || usedTo.has(c.toKey)) continue;
    usedFrom.add(c.fromKey);
    usedTo.add(c.toKey);
    plan.attacks.push({ fromKey: c.fromKey, toKey: c.toKey, send: c.send });
  }
  return plan;
}
