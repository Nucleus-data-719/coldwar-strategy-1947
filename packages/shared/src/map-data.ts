import type { ResourceKey, Resources, Terrain } from './types';
import { emptyResources } from './types';

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
];

export const COUNTRY_BY_CODE: Record<string, CountryDef> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c]),
);

export interface ProvinceGeo {
  key: string;
  name: string;
  countryCode: string;
  col: number;
  row: number;
  /** Flat [x0, y0, x1, y1, ...] polygon in map units. Independent of the renderer. */
  polygon: number[];
  center: { x: number; y: number };
  isCoastal: boolean;
  isCapital: boolean;
  terrain: Terrain;
  buildingSlots: number;
  population: number;
  production: Resources;
  specialty?: ResourceKey;
  adjacent: string[];
}

// ---- Placeholder map: 12 x 6 grid of provinces. Replace with real data later. ----

const CELL = 100;
export const MAP_WIDTH = 12 * CELL;
export const MAP_HEIGHT = 6 * CELL;

const LAYOUT = [
  'UUUGGWRRRRCJ',
  'UUUGFPRRRRCJ',
  'UUBFFPTRRCCJ',
  'BBBFPTTEICCC',
  'BBBBEEEIIICC',
  'BBBBEEEIIIII',
];

const CODE_BY_CHAR: Record<string, string> = {
  U: 'USA',
  R: 'SOV',
  G: 'GBR',
  F: 'FRA',
  C: 'CHN',
  I: 'IND',
  T: 'TUR',
  B: 'BRA',
  P: 'POL',
  E: 'EGY',
  W: 'SWE',
  J: 'JPN',
};

const DEFAULT_BASE: Record<ResourceKey, number> = {
  money: 50,
  food: 70,
  oil: 20,
  steel: 20,
  electronics: 6,
  rare: 4,
  manpower: 100,
};

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

function buildProvinces(): ProvinceGeo[] {
  const rows = LAYOUT.length;
  const cols = LAYOUT[0].length;

  // Jittered vertex grid so neighbouring provinces share exact borders.
  const jr = mulberry32(1947);
  const vx: { x: number; y: number }[][] = [];
  for (let r = 0; r <= rows; r++) {
    const line: { x: number; y: number }[] = [];
    for (let c = 0; c <= cols; c++) {
      const interior = r > 0 && r < rows && c > 0 && c < cols;
      const jx = interior ? (jr() - 0.5) * 32 : 0;
      const jy = interior ? (jr() - 0.5) * 32 : 0;
      line.push({ x: c * CELL + jx, y: r * CELL + jy });
    }
    vx.push(line);
  }

  // Group cells per country (scan order) to pick the middle one as capital.
  const cellsByCode = new Map<string, { r: number; c: number }[]>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const code = CODE_BY_CHAR[LAYOUT[r][c]];
      if (!cellsByCode.has(code)) cellsByCode.set(code, []);
      cellsByCode.get(code)!.push({ r, c });
    }
  }
  const capitalCell = new Map<string, string>();
  for (const [code, cells] of cellsByCode) {
    const mid = cells[Math.floor(cells.length / 2)];
    capitalCell.set(code, `${mid.r}_${mid.c}`);
  }

  const counters = new Map<string, number>();
  const out: ProvinceGeo[] = [];
  let index = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const code = CODE_BY_CHAR[LAYOUT[r][c]];
      const country = COUNTRY_BY_CODE[code];
      const isCapital = capitalCell.get(code) === `${r}_${c}`;
      const rng = mulberry32(1947 + index * 7919);
      index++;

      const tl = vx[r][c];
      const tr = vx[r][c + 1];
      const br = vx[r + 1][c + 1];
      const bl = vx[r + 1][c];
      const polygon = [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y];
      const center = {
        x: (tl.x + tr.x + br.x + bl.x) / 4,
        y: (tl.y + tr.y + br.y + bl.y) / 4,
      };

      const t = rng();
      const terrain: Terrain =
        t < 0.4 ? 'plains' : t < 0.6 ? 'forest' : t < 0.8 ? 'hills' : t < 0.9 ? 'mountains' : 'desert';

      const production = emptyResources();
      production.money = Math.round(30 + rng() * 50);
      production.food = Math.round(40 + rng() * 60);
      production.manpower = Math.round(60 + rng() * 90);
      production.oil = rng() < 0.35 ? Math.round(10 + rng() * 20) : 0;
      production.steel = rng() < 0.45 ? Math.round(10 + rng() * 30) : 0;
      production.electronics = rng() < 0.2 ? Math.round(2 + rng() * 8) : 0;
      production.rare = rng() < 0.15 ? Math.round(1 + rng() * 5) : 0;

      let specialty: ResourceKey | undefined;
      if (!isCapital && rng() < 0.12) {
        const choices: ResourceKey[] = ['oil', 'steel', 'food', 'electronics', 'rare'];
        specialty = choices[Math.floor(rng() * choices.length)];
        const base = production[specialty] || DEFAULT_BASE[specialty];
        production[specialty] = base * 2; // double-resource province
      }
      if (isCapital) {
        production.money = Math.round(production.money * 1.5);
        production.manpower = Math.round(production.manpower * 1.5);
      }

      let name: string;
      if (isCapital) {
        name = country.capitalName;
      } else {
        const n = (counters.get(code) ?? 0) + 1;
        counters.set(code, n);
        name = `${country.name} Province ${n}`;
      }

      const adjacent: string[] = [];
      if (r > 0) adjacent.push(`p${r - 1}_${c}`);
      if (r < rows - 1) adjacent.push(`p${r + 1}_${c}`);
      if (c > 0) adjacent.push(`p${r}_${c - 1}`);
      if (c < cols - 1) adjacent.push(`p${r}_${c + 1}`);

      out.push({
        key: `p${r}_${c}`,
        name,
        countryCode: code,
        col: c,
        row: r,
        polygon,
        center,
        isCoastal: r === 0 || r === rows - 1 || c === 0 || c === cols - 1,
        isCapital,
        terrain,
        buildingSlots: isCapital ? 5 : specialty ? 4 : 3,
        population: Math.round((200000 + rng() * 800000) * (isCapital ? 2 : 1)),
        production,
        specialty,
        adjacent,
      });
    }
  }
  return out;
}

export const PROVINCES: ProvinceGeo[] = buildProvinces();
export const PROVINCE_BY_KEY: Record<string, ProvinceGeo> = Object.fromEntries(
  PROVINCES.map((p) => [p.key, p]),
);
