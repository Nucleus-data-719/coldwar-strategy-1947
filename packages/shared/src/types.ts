export const RESOURCE_KEYS = [
  'money',
  'food',
  'oil',
  'steel',
  'electronics',
  'rare',
  'manpower',
] as const;
export type ResourceKey = (typeof RESOURCE_KEYS)[number];
export type Resources = Record<ResourceKey, number>;
export type PartialResources = Partial<Resources>;

export const RESOURCE_LABELS: Record<ResourceKey, string> = {
  money: 'Money',
  food: 'Food',
  oil: 'Oil',
  steel: 'Steel',
  electronics: 'Electronics',
  rare: 'Rare materials',
  manpower: 'Manpower',
};

export function emptyResources(): Resources {
  return { money: 0, food: 0, oil: 0, steel: 0, electronics: 0, rare: 0, manpower: 0 };
}

export const TERRAINS = ['plains', 'forest', 'hills', 'mountains', 'desert'] as const;
export type Terrain = (typeof TERRAINS)[number];

export const BUILDING_TYPES = [
  'local_factory',
  'military_factory',
  'harbor',
  'airbase',
  'research_lab',
  'university',
  'fortress',
  'railway',
  'recruitment_center',
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];
export type BuildingStatus = 'constructing' | 'complete';

export const UNIT_TYPES = [
  'infantry',
  'artillery',
  'light_tank',
  'heavy_tank',
  'fighter',
  'bomber',
  'air_support',
  'submarine',
  'destroyer',
  'cruiser',
  'battleship',
] as const;
export type UnitType = (typeof UNIT_TYPES)[number];
