import type { BuildingType, PartialResources, UnitType } from '../types';
import type { Mobility } from './era';

export interface UnitDef {
  type: UnitType;
  name: string;
  category: 'land' | 'air' | 'naval';
  attack: number;
  defense: number;
  health: number;
  /**
   * Real sustained speed in km/h for an early-1950s unit (halts, refuelling and breakdowns included).
   * Movement is compressed by MOVE_TIME_COMPRESSION (era.ts), so 1 km/h covers 24 km per game hour.
   */
  speed: number;
  /** How it moves: decides the terrain penalty (see TERRAIN_MOBILITY_MULT). */
  mobility: Mobility;
  /** Aircraft only: combat radius in km from the airbase they fly from (strikes and patrols). */
  rangeKm?: number;
  /** Aircraft only: radius in km of the area a patrol covers around its patrol point. */
  patrolKm?: number;
  /** Real 1950 equipment this unit stands for. */
  models: string;
  cost: PartialResources;
  /** Per game hour. */
  upkeep: PartialResources;
  /** Can be recruited in the current build. */
  recruitable: boolean;
  /** Can be built in a production building (see producedAt). */
  factoryProducible: boolean;
  /** The building a province needs to build it. */
  producedAt: BuildingType | null;
  /** Base seconds a factory needs for one unit (divided by GAME_SPEED). */
  buildSeconds: number;
}

export const UNITS: Record<UnitType, UnitDef> = {
  infantry: {
    type: 'infantry',
    name: 'Infantry',
    category: 'land',
    attack: 10,
    defense: 14,
    health: 100,
    speed: 8,
    mobility: 'foot',
    models: 'Rifle divisions with trucks: M1 Garand, SKS, Lee-Enfield',
    cost: { money: 60, food: 20, manpower: 100 },
    upkeep: { food: 1, money: 0.5 },
    recruitable: true,
    factoryProducible: false,
    producedAt: null,
    buildSeconds: 0,
  },
  artillery: {
    type: 'artillery',
    name: 'Field Artillery',
    category: 'land',
    attack: 22,
    defense: 6,
    health: 70,
    speed: 6,
    mobility: 'towed',
    models: 'Towed howitzers: M114 155 mm, M-30 122 mm, 25-pounder',
    cost: { money: 150, steel: 40, manpower: 60 },
    upkeep: { food: 1, money: 1, steel: 0.2 },
    recruitable: false,
    factoryProducible: true,
    producedAt: 'military_factory',
    buildSeconds: 1800,
  },
  light_tank: {
    type: 'light_tank',
    name: 'Light Tank',
    category: 'land',
    attack: 18,
    defense: 12,
    health: 110,
    speed: 14,
    mobility: 'tracked',
    models: 'M24 Chaffee, M41 Walker Bulldog, PT-76',
    cost: { money: 220, steel: 80, oil: 20, manpower: 40 },
    upkeep: { money: 1.5, oil: 0.6 },
    recruitable: false,
    factoryProducible: true,
    producedAt: 'military_factory',
    buildSeconds: 3600,
  },
  heavy_tank: {
    type: 'heavy_tank',
    name: 'Heavy Tank',
    category: 'land',
    attack: 30,
    defense: 26,
    health: 200,
    speed: 6,
    mobility: 'tracked',
    models: 'IS-3, M26 Pershing, Conqueror, later M103',
    cost: { money: 450, steel: 180, oil: 50, manpower: 50 },
    upkeep: { money: 2.5, oil: 1.4 },
    recruitable: false,
    factoryProducible: true,
    producedAt: 'military_factory',
    buildSeconds: 7200,
  },
  fighter: {
    type: 'fighter',
    name: 'Jet Fighter',
    category: 'air',
    attack: 20,
    defense: 14,
    health: 60,
    speed: 850,
    mobility: 'air',
    rangeKm: 700,
    patrolKm: 450,
    models: 'F-86 Sabre, MiG-15, Gloster Meteor',
    cost: { money: 300, steel: 60, oil: 30, electronics: 5, manpower: 20 },
    upkeep: { money: 2, oil: 1 },
    recruitable: false,
    factoryProducible: true,
    producedAt: 'airbase',
    buildSeconds: 3600,
  },
  bomber: {
    type: 'bomber',
    name: 'Strategic Bomber',
    category: 'air',
    attack: 28,
    defense: 8,
    health: 90,
    speed: 400,
    mobility: 'air',
    rangeKm: 2500,
    patrolKm: 350,
    models: 'B-29 and B-50 Superfortress, Tu-4, Avro Lincoln',
    cost: { money: 450, steel: 90, oil: 60, electronics: 8, manpower: 30 },
    upkeep: { money: 3, oil: 1.6 },
    recruitable: false,
    factoryProducible: true,
    producedAt: 'airbase',
    buildSeconds: 5400,
  },
  air_support: {
    type: 'air_support',
    name: 'Fighter-Bomber',
    category: 'air',
    attack: 24,
    defense: 10,
    health: 70,
    speed: 500,
    mobility: 'air',
    rangeKm: 550,
    patrolKm: 400,
    models: 'F-84 Thunderjet, A-1 Skyraider, Il-10',
    cost: { money: 350, steel: 70, oil: 40, electronics: 6, manpower: 20 },
    upkeep: { money: 2.2, oil: 1.2 },
    recruitable: false,
    factoryProducible: true,
    producedAt: 'airbase',
    buildSeconds: 4500,
  },
  submarine: {
    type: 'submarine',
    name: 'Submarine',
    category: 'naval',
    attack: 24,
    defense: 8,
    health: 90,
    speed: 18,
    mobility: 'sea',
    models: 'GUPPY-converted fleet boats, Whiskey class',
    cost: { money: 400, steel: 150, oil: 40, manpower: 40 },
    upkeep: { money: 2, oil: 0.8 },
    recruitable: false,
    factoryProducible: true,
    producedAt: 'harbor',
    buildSeconds: 5400,
  },
  corvette: {
    type: 'corvette',
    name: 'Corvette',
    category: 'naval',
    attack: 12,
    defense: 10,
    health: 70,
    speed: 28,
    mobility: 'sea',
    models: 'Flower-class corvettes, Kronshtadt sub-chasers',
    cost: { money: 220, steel: 90, oil: 25, manpower: 35 },
    upkeep: { money: 1.2, oil: 0.5 },
    recruitable: false,
    factoryProducible: true,
    producedAt: 'harbor',
    buildSeconds: 3600,
  },
  destroyer: {
    type: 'destroyer',
    name: 'Destroyer',
    category: 'naval',
    attack: 18,
    defense: 14,
    health: 110,
    speed: 37,
    mobility: 'sea',
    models: 'Gearing class, Skoryy class, Battle class',
    cost: { money: 380, steel: 160, oil: 45, manpower: 60 },
    upkeep: { money: 2, oil: 0.9 },
    recruitable: false,
    factoryProducible: true,
    producedAt: 'harbor',
    buildSeconds: 5400,
  },
  cruiser: {
    type: 'cruiser',
    name: 'Cruiser',
    category: 'naval',
    attack: 28,
    defense: 22,
    health: 180,
    speed: 33,
    mobility: 'sea',
    models: 'Baltimore class, Sverdlov class',
    cost: { money: 700, steel: 300, oil: 80, manpower: 100 },
    upkeep: { money: 3.5, oil: 1.6 },
    recruitable: false,
    factoryProducible: true,
    producedAt: 'harbor',
    buildSeconds: 9000,
  },
  battleship: {
    type: 'battleship',
    name: 'Battleship',
    category: 'naval',
    attack: 45,
    defense: 40,
    health: 320,
    speed: 30,
    mobility: 'sea',
    models: 'Iowa class, HMS Vanguard, Richelieu',
    cost: { money: 1400, steel: 650, oil: 160, manpower: 200 },
    upkeep: { money: 6, oil: 3 },
    recruitable: false,
    factoryProducible: true,
    producedAt: 'harbor',
    buildSeconds: 14400,
  },
};
