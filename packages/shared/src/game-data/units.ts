import type { PartialResources, UnitType } from '../types';

export interface UnitDef {
  type: UnitType;
  name: string;
  category: 'land' | 'air' | 'naval';
  attack: number;
  defense: number;
  health: number;
  /** Provinces per hour on open ground (used by the movement update). */
  speed: number;
  cost: PartialResources;
  /** Per game hour. */
  upkeep: PartialResources;
  /** Can be recruited in the current build. */
  recruitable: boolean;
}

export const UNITS: Record<UnitType, UnitDef> = {
  infantry: {
    type: 'infantry',
    name: 'Infantry',
    category: 'land',
    attack: 10,
    defense: 14,
    health: 100,
    speed: 1,
    cost: { money: 60, food: 20, manpower: 100 },
    upkeep: { food: 1, money: 0.5 },
    recruitable: true,
  },
  artillery: {
    type: 'artillery',
    name: 'Artillery',
    category: 'land',
    attack: 22,
    defense: 6,
    health: 70,
    speed: 0.6,
    cost: { money: 150, steel: 40, manpower: 60 },
    upkeep: { food: 1, money: 1, steel: 0.2 },
    recruitable: false,
  },
  light_tank: {
    type: 'light_tank',
    name: 'Light Tank',
    category: 'land',
    attack: 18,
    defense: 12,
    health: 110,
    speed: 1.6,
    cost: { money: 220, steel: 80, oil: 20, manpower: 40 },
    upkeep: { money: 1.5, oil: 0.6 },
    recruitable: false,
  },
  heavy_tank: {
    type: 'heavy_tank',
    name: 'Heavy Tank',
    category: 'land',
    attack: 30,
    defense: 26,
    health: 200,
    speed: 0.8,
    cost: { money: 450, steel: 180, oil: 50, manpower: 50 },
    upkeep: { money: 2.5, oil: 1.4 },
    recruitable: false,
  },
  fighter: {
    type: 'fighter',
    name: 'Fighter',
    category: 'air',
    attack: 20,
    defense: 14,
    health: 60,
    speed: 4,
    cost: { money: 300, steel: 60, oil: 30, electronics: 5, manpower: 20 },
    upkeep: { money: 2, oil: 1 },
    recruitable: false,
  },
  bomber: {
    type: 'bomber',
    name: 'Bomber',
    category: 'air',
    attack: 28,
    defense: 8,
    health: 90,
    speed: 3,
    cost: { money: 450, steel: 90, oil: 60, electronics: 8, manpower: 30 },
    upkeep: { money: 3, oil: 1.6 },
    recruitable: false,
  },
  air_support: {
    type: 'air_support',
    name: 'Air Support',
    category: 'air',
    attack: 24,
    defense: 10,
    health: 70,
    speed: 3.5,
    cost: { money: 350, steel: 70, oil: 40, electronics: 6, manpower: 20 },
    upkeep: { money: 2.2, oil: 1.2 },
    recruitable: false,
  },
  submarine: {
    type: 'submarine',
    name: 'Submarine',
    category: 'naval',
    attack: 24,
    defense: 8,
    health: 90,
    speed: 1.2,
    cost: { money: 400, steel: 150, oil: 40, manpower: 40 },
    upkeep: { money: 2, oil: 0.8 },
    recruitable: false,
  },
  destroyer: {
    type: 'destroyer',
    name: 'Destroyer',
    category: 'naval',
    attack: 18,
    defense: 14,
    health: 110,
    speed: 1.8,
    cost: { money: 380, steel: 160, oil: 45, manpower: 60 },
    upkeep: { money: 2, oil: 0.9 },
    recruitable: false,
  },
  cruiser: {
    type: 'cruiser',
    name: 'Cruiser',
    category: 'naval',
    attack: 28,
    defense: 22,
    health: 180,
    speed: 1.4,
    cost: { money: 700, steel: 300, oil: 80, manpower: 100 },
    upkeep: { money: 3.5, oil: 1.6 },
    recruitable: false,
  },
  battleship: {
    type: 'battleship',
    name: 'Battleship',
    category: 'naval',
    attack: 45,
    defense: 40,
    health: 320,
    speed: 1,
    cost: { money: 1400, steel: 650, oil: 160, manpower: 200 },
    upkeep: { money: 6, oil: 3 },
    recruitable: false,
  },
};
