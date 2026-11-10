import type { BattleModifier } from './combat';
import type { CombatUnit } from './combat';

export const AIR_SUPERIORITY_PERCENT = 8;
export const CLOSE_AIR_SUPPORT_PERCENT = 6;

const count = (units: CombatUnit[], type: string) => units.filter((u) => u.unitType === type).reduce((s, u) => s + u.count, 0);
const landCount = (units: CombatUnit[]) =>
  units.filter((u) => ['infantry', 'artillery', 'light_tank', 'heavy_tank'].includes(u.unitType)).reduce((s, u) => s + u.count, 0);

/**
 * Basic air war. The side with more fighters than the other has air superiority. Air support
 * aircraft help a side that has land units on the ground. Aircraft also fight with their own stats.
 */
export function airModifiers(side: 'attacker' | 'defender', own: CombatUnit[], enemy: CombatUnit[]): BattleModifier[] {
  const out: BattleModifier[] = [];
  if (count(own, 'fighter') > count(enemy, 'fighter')) {
    out.push({ side, label: 'Air superiority', percent: AIR_SUPERIORITY_PERCENT });
  }
  if (count(own, 'air_support') > 0 && landCount(own) > 0) {
    out.push({ side, label: 'Close air support', percent: CLOSE_AIR_SUPPORT_PERCENT });
  }
  return out;
}
