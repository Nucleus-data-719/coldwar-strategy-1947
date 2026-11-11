import type { BuildingType, PartialResources } from '../types';

export interface BuildingDef {
  type: BuildingType;
  name: string;
  description: string;
  cost: PartialResources;
  /** Base construction time in seconds (divided by GAME_SPEED on the server). */
  buildSeconds: number;
  requiresCoastal?: boolean;
  /** True when the gameplay effect already works in the current build. */
  effectActive: boolean;
  /** Added to the province production multiplier (0.25 = +25%). */
  productionBonus?: number;
  /** A completed building of this kind auto-recruits one infantry every N seconds. */
  recruitIntervalSeconds?: number;
  defenseBonus?: number;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  local_factory: {
    type: 'local_factory',
    name: 'Local Factory',
    description: 'Increases money and strategic resource (oil, steel, electronics, rare earth, wood) production of this province by 25%. Food and manpower are not affected.',
    cost: { wood: 60, money: 400, steel: 80 },
    buildSeconds: 3600,
    effectActive: true,
    productionBonus: 0.25,
  },
  recruitment_center: {
    type: 'recruitment_center',
    name: 'Recruitment Center',
    description: 'Automatically recruits one infantry every hour (costs money, food and manpower).',
    cost: { wood: 40, money: 300, steel: 50 },
    buildSeconds: 1800,
    effectActive: true,
    recruitIntervalSeconds: 3600,
  },
  military_factory: {
    type: 'military_factory',
    name: 'Military Factory',
    description: 'Produces artillery and tanks, one unit at a time, from a queue.',
    cost: { wood: 100, money: 800, steel: 200 },
    buildSeconds: 7200,
    effectActive: true,
  },
  harbor: {
    type: 'harbor',
    name: 'Harbor',
    description: 'Coastal only. Builds submarines, corvettes, destroyers, cruisers and battleships once they are researched.',
    cost: { wood: 120, money: 600, steel: 150 },
    buildSeconds: 5400,
    requiresCoastal: true,
    effectActive: true,
  },
  airbase: {
    type: 'airbase',
    name: 'Airbase',
    description: 'Builds fighters, bombers and air support aircraft once they are researched.',
    cost: { wood: 80, money: 900, steel: 250, oil: 50 },
    buildSeconds: 7200,
    effectActive: true,
  },
  research_lab: {
    type: 'research_lab',
    name: 'Research Laboratory',
    description: 'Research speed +15% for the next project you start. Total research speed is capped at +100%.',
    cost: { wood: 60, money: 700, steel: 100, electronics: 40 },
    buildSeconds: 7200,
    effectActive: true,
  },
  university: {
    type: 'university',
    name: 'University',
    description: 'Research speed +25% for the next project you start. Total research speed is capped at +100%.',
    cost: { wood: 100, money: 1000, steel: 150, electronics: 60 },
    buildSeconds: 10800,
    effectActive: true,
  },
  fortress: {
    type: 'fortress',
    name: 'Fortress',
    description: 'Defenders in this province get +25% attack and defence in battle.',
    cost: { wood: 100, money: 500, steel: 300 },
    buildSeconds: 5400,
    effectActive: true,
    defenseBonus: 25,
  },
  railway: {
    type: 'railway',
    name: 'Railway',
    description: 'Halves army travel time between two of your provinces that both have a railway.',
    cost: { wood: 80, money: 300, steel: 120 },
    buildSeconds: 3600,
    effectActive: true,
  },
};
