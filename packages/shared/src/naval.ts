import { UNITS } from './game-data/units';
import { TUNING, seededRandom } from './combat';
import { SEA_DOTS, portNodes, seaNeighbors, PROVINCE_BY_KEY, type Point } from './map-data';
import { MAP_UNITS_PER_PROVINCE } from './movement';
import type { PartialResources, UnitType } from './types';

type Units = { unitType: UnitType; count: number }[];

/** How many sea lanes (dot-to-dot links) away each ship can fight. Submarines must be on top of the enemy. */
export const SEA_RANGE: Partial<Record<UnitType, number>> = { submarine: 0, corvette: 1, destroyer: 1, cruiser: 1, battleship: 2 };
export const seaRange = (t: UnitType): number => SEA_RANGE[t] ?? 0;

/** Ships that can lay mines. */
export const MINELAYERS: UnitType[] = ['submarine', 'corvette', 'destroyer'];
/** Ships that can find submarines. */
export const SUB_HUNTERS: UnitType[] = ['corvette', 'destroyer'];

/** Ships see enemy ships this many lanes away; your coast sees this far out from your harbours. */
export const SHIP_SIGHT_HOPS = 3;
export const COAST_SIGHT_HOPS = 2;
/** Destroyers and corvettes find hidden submarines this many lanes away. */
export const SUB_SPOT_HOPS = 3;
/** Destroyers and corvettes find mines this many lanes away. */
export const MINE_SPOT_HOPS = 1;

export const MINE_LIFETIME_HOURS = 72;
export const MINE_MAX_STRENGTH = 20;
export const MINE_STRENGTH_PER_SHIP = 3;
export const MINE_COST_PER_SHIP: PartialResources = { money: 10, steel: 20 };
/** Share of an enemy fleet lost to a field of this strength, per crossing. */
export const mineLossPct = (strength: number): number => Math.min(0.25, 0.03 * strength);

export const isNavalUnits = (units: Units): boolean =>
  units.some((u) => u.count > 0) && units.every((u) => u.count <= 0 || UNITS[u.unitType].category === 'naval');
/** A force made only of submarines is hidden from the enemy. */
export const isHiddenFleet = (units: Units): boolean => units.some((u) => u.count > 0) && units.every((u) => u.count <= 0 || u.unitType === 'submarine');
export const minelayerCount = (units: Units): number => units.reduce((s, u) => s + (MINELAYERS.includes(u.unitType) ? u.count : 0), 0);
export const hasSubHunters = (units: Units): boolean => units.some((u) => u.count > 0 && SUB_HUNTERS.includes(u.unitType));
/** A fleet closes in until all its ships can fire: the shortest range among its ships. */
export function fleetRange(units: Units): number {
  let r = Infinity;
  for (const u of units) if (u.count > 0) r = Math.min(r, seaRange(u.unitType));
  return Number.isFinite(r) ? r : 0;
}

// ---------- the dots ----------
/** Distance in lanes from a set of dots, out to `maxDepth`. */
export function hopsFrom(starts: readonly number[], maxDepth: number): Map<number, number> {
  const dist = new Map<number, number>();
  let frontier: number[] = [];
  for (const s of starts) if (!dist.has(s)) { dist.set(s, 0); frontier.push(s); }
  for (let d = 1; d <= maxDepth; d++) {
    const next: number[] = [];
    for (const n of frontier) for (const m of seaNeighbors(n)) if (!dist.has(m)) { dist.set(m, d); next.push(m); }
    frontier = next;
  }
  return dist;
}

const dotDist = (a: number, b: number) => Math.hypot(SEA_DOTS[a][0] - SEA_DOTS[b][0], SEA_DOTS[a][1] - SEA_DOTS[b][1]);

/** Shortest line of dots between two dots (inclusive), or null when they are not connected. */
export function seaPathNodes(from: number, to: number): number[] | null {
  if (from === to) return [from];
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const done = new Set<number>();
  for (;;) {
    let cur = -1;
    let best = Infinity;
    for (const [k, v] of dist) if (!done.has(k) && v < best) { best = v; cur = k; }
    if (cur < 0) return null;
    if (cur === to) break;
    done.add(cur);
    for (const nb of seaNeighbors(cur)) {
      const c = best + dotDist(cur, nb);
      if (c < (dist.get(nb) ?? Infinity)) { dist.set(nb, c); prev.set(nb, cur); }
    }
  }
  const out = [to];
  while (prev.has(out[0])) out.unshift(prev.get(out[0])!);
  return out;
}

/** The dot nearest a point on the map, within `maxDist` map units. */
export function nearestSeaNode(x: number, y: number, maxDist = 40): number | null {
  let best = -1;
  let bd = maxDist;
  for (let i = 0; i < SEA_DOTS.length; i++) {
    const d = Math.hypot(SEA_DOTS[i][0] - x, SEA_DOTS[i][1] - y);
    if (d <= bd) { bd = d; best = i; }
  }
  return best < 0 ? null : best;
}

/** The dot a ship in this province starts from: the port dot closest to `towards` (or the first). */
export function startNodeFromPort(provinceKey: string, towards?: number): number | null {
  const ports = portNodes(provinceKey);
  if (ports.length === 0) return null;
  if (towards === undefined) return ports[0];
  return [...ports].sort((a, b) => dotDist(a, towards) - dotDist(b, towards))[0];
}

export function pathLength(nodes: readonly number[]): number {
  let n = 0;
  for (let i = 1; i < nodes.length; i++) n += dotDist(nodes[i - 1], nodes[i]);
  return n;
}

/** Seconds a fleet needs to sail a line of dots. */
export function voyageSeconds(lengthUnits: number, speed: number, gameSpeed: number): number {
  const hours = lengthUnits / MAP_UNITS_PER_PROVINCE / speed;
  return Math.max(1, Math.round((hours * 3600) / gameSpeed));
}

/** The line a voyage draws: from the province the ship leaves (if any), along the dots, into the port it reaches (if any). */
export function voyagePoints(fromProvinceKey: string | null, nodes: readonly number[], toProvinceKey: string | null): Point[] {
  const pts: Point[] = [];
  if (fromProvinceKey) pts.push([PROVINCE_BY_KEY[fromProvinceKey].center.x, PROVINCE_BY_KEY[fromProvinceKey].center.y]);
  for (const n of nodes) pts.push(SEA_DOTS[n]);
  if (toProvinceKey) pts.push([PROVINCE_BY_KEY[toProvinceKey].center.x, PROVINCE_BY_KEY[toProvinceKey].center.y]);
  return pts;
}

/** The dot a fleet has reached after sailing a share of the way along `nodes`. */
export function nodeAtProgress(nodes: readonly number[], fraction: number): number {
  const total = pathLength(nodes);
  let want = total * Math.min(1, Math.max(0, fraction));
  for (let i = 1; i < nodes.length; i++) {
    const seg = dotDist(nodes[i - 1], nodes[i]);
    if (want < seg) return nodes[i - 1];
    want -= seg;
  }
  return nodes[nodes.length - 1];
}

/** Where along `nodes` a fleet with this range stops to fire at a target dot: the first dot within range. */
export function firingPosition(nodes: readonly number[], targetNode: number, range: number): number[] {
  const near = hopsFrom([targetNode], Math.max(range, 0));
  for (let i = 0; i < nodes.length; i++) if ((near.get(nodes[i]) ?? Infinity) <= range) return nodes.slice(0, i + 1);
  return nodes.slice();
}

// ---------- fighting at sea ----------
const ANTI_SUB: Partial<Record<UnitType, number>> = { battleship: 0.25, cruiser: 0.5, destroyer: 1.5, corvette: 1.5, submarine: 1 };

function antiSubFactor(attacker: UnitType, defenders: Units): number {
  const weight = (u: { unitType: UnitType; count: number }) => u.count * UNITS[u.unitType].health;
  const total = defenders.reduce((s, u) => s + weight(u), 0);
  if (total <= 0) return 1;
  const subs = defenders.filter((u) => u.unitType === 'submarine').reduce((s, u) => s + weight(u), 0) / total;
  return 1 - subs + subs * (ANTI_SUB[attacker] ?? 1);
}

export interface NavalResult {
  attackerAfter: Units;
  defenderAfter: Units;
  attackerLossPct: number;
  defenderLossPct: number;
}

function strengthOf(units: Units, share: number): Units {
  return units.map((u) => ({ unitType: u.unitType, count: Math.round(u.count * share) })).filter((u) => u.count > 0);
}

/**
 * Ships fight in rounds, both sides at once, with the same damage rule as land battles. What is new is range:
 * only ships whose range reaches the enemy (`hops` lanes away) can fire. A battleship shelling a destroyer from
 * two lanes away takes no return fire. Against submarines, battleships and cruisers are poor shots and
 * destroyers and corvettes are good ones.
 */
export function navalEngagement(input: { seed: number; attackerUnits: Units; defenderUnits: Units; hops: number }): NavalResult {
  const { attackerUnits, defenderUnits, hops } = input;
  const rand = seededRandom(input.seed);
  const side = (own: Units, enemy: Units) => {
    let hp = 0;
    let defence = 0;
    let attack = 0;
    for (const u of own) {
      const d = UNITS[u.unitType];
      hp += u.count * d.health;
      defence += u.count * d.defense;
      if (seaRange(u.unitType) >= hops) attack += u.count * d.attack * antiSubFactor(u.unitType, enemy);
    }
    return { hp, defence, attack };
  };
  const a = side(attackerUnits, defenderUnits);
  const d = side(defenderUnits, attackerUnits);
  let aHp = a.hp;
  let dHp = d.hp;
  const luckA = 1 + (rand() - 0.5) * TUNING.luck * 0.4;
  const luckD = 1 + (rand() - 0.5) * TUNING.luck * 0.4;
  for (let round = 0; round < 30 && aHp > a.hp * 0.1 && dHp > d.hp * 0.1; round++) {
    const aAtk = a.attack * (aHp / a.hp) * luckA * (0.85 + rand() * 0.3);
    const dAtk = d.attack * (dHp / d.hp) * luckD * (0.85 + rand() * 0.3);
    const aDmg = aAtk > 0 ? (TUNING.intensity * aAtk * aAtk) / (aAtk + d.defence * (dHp / d.hp)) : 0;
    const dDmg = dAtk > 0 ? (TUNING.intensity * dAtk * dAtk) / (dAtk + a.defence * (aHp / a.hp)) : 0;
    if (aDmg <= 0 && dDmg <= 0) break; // nobody can reach anybody
    dHp = Math.max(0, dHp - aDmg);
    aHp = Math.max(0, aHp - dDmg);
  }
  const aShare = a.hp > 0 ? aHp / a.hp : 0;
  const dShare = d.hp > 0 ? dHp / d.hp : 0;
  return {
    attackerAfter: aShare < 0.1 ? [] : strengthOf(attackerUnits, aShare),
    defenderAfter: dShare < 0.1 ? [] : strengthOf(defenderUnits, dShare),
    attackerLossPct: Math.round((1 - (aShare < 0.1 ? 0 : aShare)) * 100),
    defenderLossPct: Math.round((1 - (dShare < 0.1 ? 0 : dShare)) * 100),
  };
}
