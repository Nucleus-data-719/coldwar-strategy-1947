import type { ResourceKey, Resources, Terrain } from './types';
import { emptyResources } from './types';
import { GENERATED_PROVINCES, GENERATED_ROADS, MAP_HEIGHT, MAP_WIDTH } from './map-geometry.generated';

export interface CountryDef {
  code: string;
  name: string;
  color: string;
  playable: boolean;
  capitalName: string;
  blurb: string;
  startBonus?: Partial<Resources>;
}

export const COUNTRIES: CountryDef[] = [
  {
    code: 'USA',
    name: 'United States',
    color: '#3b6fd8',
    playable: true,
    capitalName: 'Washington',
    blurb: 'Strong economy and industrial capacity.',
    startBonus: { money: 3000, steel: 800, electronics: 60 },
  },
  {
    code: 'SOV',
    name: 'Soviet Union',
    color: '#c63d3d',
    playable: true,
    capitalName: 'Moscow',
    blurb: 'Vast land, large manpower pool and rich natural resources.',
    startBonus: { manpower: 15000, oil: 600, steel: 600 },
  },
  {
    code: 'GBR',
    name: 'United Kingdom',
    color: '#8e4fc4',
    playable: true,
    capitalName: 'London',
    blurb: 'Wealthy trading power with overseas interests.',
    startBonus: { money: 2000, electronics: 40 },
  },
  {
    code: 'FRA',
    name: 'France',
    color: '#2fa4c8',
    playable: true,
    capitalName: 'Paris',
    blurb: 'Industrial base at the centre of Europe.',
    startBonus: { money: 1000, steel: 500 },
  },
  {
    code: 'CHN',
    name: 'China',
    color: '#d9a62e',
    playable: true,
    capitalName: 'Nanjing',
    blurb: 'Enormous population, limited industry.',
    startBonus: { manpower: 20000, food: 1500 },
  },
  {
    code: 'IND',
    name: 'India',
    color: '#e07a2d',
    playable: true,
    capitalName: 'Delhi',
    blurb: 'Large population and growing economy.',
    startBonus: { manpower: 12000, food: 1500 },
  },
  {
    code: 'TUR',
    name: 'Turkey',
    color: '#4aa86b',
    playable: true,
    capitalName: 'Ankara',
    blurb: 'Strategic crossroads between Europe and Asia.',
    startBonus: { money: 800, oil: 200 },
  },
  {
    code: 'BRA',
    name: 'Brazil',
    color: '#7fbf3f',
    playable: true,
    capitalName: 'Rio de Janeiro',
    blurb: 'Rich in food and raw materials.',
    startBonus: { food: 2000, rare: 40 },
  },
  {
    code: 'POL',
    name: 'Poland',
    color: '#c46a8b',
    playable: false,
    capitalName: 'Warsaw',
    blurb: 'AI-controlled regional power.',
  },
  {
    code: 'EGY',
    name: 'Egypt',
    color: '#b79a5b',
    playable: false,
    capitalName: 'Cairo',
    blurb: 'AI-controlled regional power.',
  },
  {
    code: 'SWE',
    name: 'Sweden',
    color: '#5fb3d9',
    playable: false,
    capitalName: 'Stockholm',
    blurb: 'AI-controlled neutral country.',
  },
  {
    code: 'JPN',
    name: 'Japan',
    color: '#d96fa3',
    playable: false,
    capitalName: 'Tokyo',
    blurb: 'AI-controlled regional power.',
  },
  { code: 'MEX', name: 'Mexico', color: '#6f9a3c', playable: false, capitalName: 'Mexico City', blurb: 'AI-controlled regional power (Mexico and Central America).' },
  { code: 'CAN', name: 'Canada', color: '#a84a4a', playable: false, capitalName: 'Ottawa', blurb: 'AI-controlled northern dominion.' },
  { code: 'COL', name: 'Andean States', color: '#c9803a', playable: false, capitalName: 'Bogota', blurb: 'AI-controlled northern South America.' },
  { code: 'ARG', name: 'Southern Cone', color: '#6fa8c9', playable: false, capitalName: 'Buenos Aires', blurb: 'AI-controlled Argentina, Chile and Paraguay.' },
  { code: 'NLD', name: 'Low Countries', color: '#e0894a', playable: false, capitalName: 'Amsterdam', blurb: 'AI-controlled Benelux.' },
  { code: 'ESP', name: 'Iberia', color: '#c9b24a', playable: false, capitalName: 'Madrid', blurb: 'AI-controlled Spain and Portugal.' },
  { code: 'GER', name: 'Germany', color: '#7a7a85', playable: false, capitalName: 'Berlin', blurb: 'AI-controlled central European power.' },
  { code: 'CEN', name: 'Central Europe', color: '#9f7ab8', playable: false, capitalName: 'Vienna', blurb: 'AI-controlled Austria, Bohemia and Hungary.' },
  { code: 'ITA', name: 'Italy', color: '#5fbf8f', playable: false, capitalName: 'Rome', blurb: 'AI-controlled Mediterranean power.' },
  { code: 'BAL', name: 'Balkans', color: '#b85f5f', playable: false, capitalName: 'Belgrade', blurb: 'AI-controlled Balkan states.' },
  { code: 'IRN', name: 'Iran', color: '#4a9f8f', playable: false, capitalName: 'Tehran', blurb: 'AI-controlled oil-rich highland state.' },
  { code: 'MES', name: 'Levant and Iraq', color: '#a4678f', playable: false, capitalName: 'Baghdad', blurb: 'AI-controlled Middle Eastern states.' },
  { code: 'SAU', name: 'Arabia', color: '#8fa84a', playable: false, capitalName: 'Riyadh', blurb: 'AI-controlled desert kingdoms.' },
  { code: 'ETH', name: 'East Africa', color: '#7a8f5f', playable: false, capitalName: 'Khartoum', blurb: 'AI-controlled Sudan, Ethiopia and Kenya.' },
  { code: 'MAR', name: 'Maghreb', color: '#b89a7a', playable: false, capitalName: 'Rabat', blurb: 'AI-controlled North Africa.' },
  { code: 'NGA', name: 'West Africa', color: '#5f9fb8', playable: false, capitalName: 'Lagos', blurb: 'AI-controlled West African states.' },
  { code: 'ZAF', name: 'Southern Africa', color: '#9f8f5f', playable: false, capitalName: 'Johannesburg', blurb: 'AI-controlled Southern and Central Africa.' },
  { code: 'KOR', name: 'Korea', color: '#8f7ab8', playable: false, capitalName: 'Seoul', blurb: 'AI-controlled Korean peninsula.' },
  { code: 'PAK', name: 'Pakistan', color: '#4f8f5f', playable: false, capitalName: 'Karachi', blurb: 'AI-controlled Pakistan and Afghanistan.' },
  { code: 'SEA', name: 'Southeast Asia', color: '#c98f5f', playable: false, capitalName: 'Rangoon', blurb: 'AI-controlled Burma, Siam and Indochina.' },
];

export const COUNTRY_BY_CODE: Record<string, CountryDef> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c]),
);

export interface ProvinceGeo {
  key: string;
  name: string;
  countryCode: string;
  /** Flat [x0, y0, x1, y1, ...] polygon in map units. Independent of the renderer. */
  polygon: number[];
  center: { x: number; y: number };
  isCoastal: boolean;
  isCapital: boolean;
  terrain: Terrain;
  buildingSlots: number;
  population: number;
  production: Resources;
  /** The one strategic resource this province produces, if it has a deposit. */
  deposit?: 'oil' | 'steel' | 'electronics' | 'rare';
  /** A double-resource region: the deposit produces twice as much. */
  doubled: boolean;
  adjacent: string[];
  /** Neighbours reachable by road. Land forces move only along these. */
  roads: string[];
}

// The map is generated by packages/shared/scripts/generate-map.mjs (simplified real geography).
export { MAP_HEIGHT, MAP_WIDTH };

/** What one deposit produces per hour. Fixed, so every country's deposits are worth the same. */
export const DEPOSIT_OUTPUT: Record<'oil' | 'steel' | 'electronics' | 'rare', number> = {
  oil: 24,
  steel: 28,
  electronics: 8,
  rare: 5,
};

const FOOD_BY_TERRAIN: Record<Terrain, number> = { plains: 1.2, forest: 1, hills: 0.9, mountains: 0.6, desert: 0.4 };
const MANPOWER_BY_TERRAIN: Record<Terrain, number> = { plains: 1.1, forest: 1, hills: 1, mountains: 0.8, desert: 0.7 };

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type RoadKind = 'highway' | 'road' | 'ferry';

/** Roads between provinces. Highways run out of capitals; ferries are the long sea lanes between landmasses. */
export const ROADS: { a: string; b: string; kind: RoadKind }[] = GENERATED_ROADS.map(([a, b, kind]) => ({ a, b, kind }));
const roadsOf = new Map<string, string[]>();
const roadKind = new Map<string, RoadKind>();
const roadId = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
for (const r of ROADS) {
  roadsOf.set(r.a, [...(roadsOf.get(r.a) ?? []), r.b]);
  roadsOf.set(r.b, [...(roadsOf.get(r.b) ?? []), r.a]);
  roadKind.set(roadId(r.a, r.b), r.kind);
}
/** The kind of road between two provinces, or undefined when there is none. */
export const roadBetween = (a: string, b: string): RoadKind | undefined => roadKind.get(roadId(a, b));

function buildProvinces(): ProvinceGeo[] {
  return GENERATED_PROVINCES.map((g, index) => {
    const rng = mulberry32(1947 + index * 7919);
    const isCapital = g.isCapital;
    const terrain = g.terrain;

    const production = emptyResources();
    // Every province grows food, raises manpower and earns some money. The ranges are narrow so
    // that provinces differ by terrain, not by luck.
    production.money = Math.round(40 + rng() * 20);
    production.food = Math.round((55 + rng() * 25) * FOOD_BY_TERRAIN[terrain]);
    production.manpower = Math.round((80 + rng() * 40) * MANPOWER_BY_TERRAIN[terrain]);
    // Strategic resources come only from deposits; a doubled region produces twice as much.
    const deposit = g.deposit;
    if (deposit) production[deposit] = DEPOSIT_OUTPUT[deposit] * (g.doubled ? 2 : 1);
    if (isCapital) {
      production.money = Math.round(production.money * 1.5);
      production.manpower = Math.round(production.manpower * 1.5);
    }

    return {
      key: g.key,
      name: g.name,
      countryCode: g.countryCode,
      polygon: g.polygon,
      center: { x: g.center[0], y: g.center[1] },
      isCoastal: g.isCoastal,
      isCapital,
      terrain,
      buildingSlots: isCapital ? 5 : g.doubled ? 4 : 3,
      population: Math.round((200000 + rng() * 800000) * (isCapital ? 2 : 1)),
      production,
      deposit,
      doubled: !!g.doubled,
      adjacent: g.adjacent,
      roads: roadsOf.get(g.key) ?? [],
    };
  });
}

/** Country sizes, so that every player starts with a fair share. */
export type CountryTier = 'big' | 'medium' | 'minor';
export const COUNTRY_TIER: Record<string, CountryTier> = {
  USA: 'big', SOV: 'big', CHN: 'big', IND: 'big', BRA: 'big',
  GBR: 'medium', FRA: 'medium', TUR: 'medium',
};
export const tierOf = (code: string): CountryTier => COUNTRY_TIER[code] ?? 'minor';
/** Big countries have 10 provinces, medium 8, and AI-run minor countries 4 or fewer. */
export const TIER_PROVINCES: Record<CountryTier, number> = { big: 10, medium: 8, minor: 4 };

export const PROVINCES: ProvinceGeo[] = buildProvinces();
export const PROVINCE_BY_KEY: Record<string, ProvinceGeo> = Object.fromEntries(
  PROVINCES.map((p) => [p.key, p]),
);
