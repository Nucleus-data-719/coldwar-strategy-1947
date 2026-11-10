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
    description: 'Increases all resource production of this province by 25%.',
    cost: { money: 400, steel: 80 },
    buildSeconds: 3600,
    effectActive: true,
    productionBonus: 0.25,
  },
  recruitment_center: {
    type: 'recruitment_center',
    name: 'Recruitment Center',
    description: 'Automatically recruits one infantry every hour (costs money, food and manpower).',
    cost: { money: 300, steel: 50 },
    buildSeconds: 1800,
    effectActive: true,
    recruitIntervalSeconds: 3600,
  },
  military_factory: {
    type: 'military_factory',
    name: 'Military Factory',
    description: 'Produces artillery and tanks, one unit at a time, from a queue.',
    cost: { money: 800, steel: 200 },
    buildSeconds: 7200,
    effectActive: true,
  },
  harbor: {
    type: 'harbor',
    name: 'Harbor',
    description: 'Coastal only. Will enable naval production (arrives with the military update).',
    cost: { money: 600, steel: 150 },
    buildSeconds: 5400,
    requiresCoastal: true,
    effectActive: false,
  },
  airbase: {
    type: 'airbase',
    name: 'Airbase',
    description: 'Will allow aircraft deployment (arrives with the military update).',
    cost: { money: 900, steel: 250, oil: 50 },
    buildSeconds: 7200,
    effectActive: false,
  },
  research_lab: {
    type: 'research_lab',
    name: 'Research Laboratory',
    description: 'Will improve research speed (arrives with the research update).',
    cost: { money: 700, steel: 100, electronics: 40 },
    buildSeconds: 7200,
    effectActive: false,
  },
  university: {
    type: 'university',
    name: 'University',
    description: 'Will raise national scientific capacity (arrives with the research update).',
    cost: { money: 1000, steel: 150, electronics: 60 },
    buildSeconds: 10800,
    effectActive: false,
  },
  fortress: {
    type: 'fortress',
    name: 'Fortress',
    description: 'Defenders in this province get +25% attack and defence in battle.',
    cost: { money: 500, steel: 300 },
    buildSeconds: 5400,
    effectActive: true,
    defenseBonus: 25,
  },
  railway: {
    type: 'railway',
    name: 'Railway',
    description: 'Halves army travel time between two of your provinces that both have a railway.',
    cost: { money: 300, steel: 120 },
    buildSeconds: 3600,
    effectActive: true,
  },
};
