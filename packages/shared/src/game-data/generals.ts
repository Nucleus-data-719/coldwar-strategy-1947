import type { UnitType } from '../types';

export type GeneralCategory = 'infantry' | 'armor' | 'air' | 'naval' | 'strategist';
export type GeneralRarity = 'common' | 'rare' | 'epic';

export const GENERAL_CATEGORIES: { id: GeneralCategory; name: string; blurb: string; units: UnitType[] | 'all'; ability: string }[] = [
  { id: 'infantry', name: 'Infantry', blurb: 'Bonus when the army contains infantry or artillery.', units: ['infantry', 'artillery'], ability: 'Hold the Line' },
  { id: 'armor', name: 'Armor', blurb: 'Bonus when the army contains tanks.', units: ['light_tank', 'heavy_tank'], ability: 'Armoured Thrust' },
  { id: 'air', name: 'Air', blurb: 'Bonus when the army contains aircraft (aircraft arrive in the air update).', units: ['fighter', 'bomber', 'air_support'], ability: 'Air Superiority' },
  { id: 'naval', name: 'Naval', blurb: 'Bonus when the force contains ships.', units: ['submarine', 'corvette', 'destroyer', 'cruiser', 'battleship'], ability: 'Sea Control' },
  { id: 'strategist', name: 'Strategist', blurb: 'Bonus for any army.', units: 'all', ability: 'Master Plan' },
];

export interface GeneralDef {
  id: string;
  name: string;
  category: GeneralCategory;
  rarity: GeneralRarity;
  nation: string;
  /** One line on the historical figure. */
  bio: string;
}

export const GENERALS: GeneralDef[] = [
  { id: 'ridgway', name: 'Matthew Ridgway', category: 'infantry', rarity: 'common', nation: 'United States', bio: 'Rebuilt a beaten Eighth Army in Korea in early 1951.' },
  { id: 'chuikov', name: 'Vasily Chuikov', category: 'infantry', rarity: 'rare', nation: 'Soviet Union', bio: 'Held Stalingrad with close-quarters tactics; later commanded Soviet ground forces.' },
  { id: 'giap', name: 'Vo Nguyen Giap', category: 'infantry', rarity: 'epic', nation: 'Vietnam', bio: 'Led the army that won at Dien Bien Phu in 1954.' },
  { id: 'abrams', name: 'Creighton Abrams', category: 'armor', rarity: 'common', nation: 'United States', bio: 'Famed tank battalion commander; later US Army chief of staff.' },
  { id: 'sharon', name: 'Ariel Sharon', category: 'armor', rarity: 'rare', nation: 'Israel', bio: 'Armoured division commander in the 1973 war.' },
  { id: 'zhukov', name: 'Georgy Zhukov', category: 'armor', rarity: 'epic', nation: 'Soviet Union', bio: 'Marshal of the Soviet Union and later defence minister.' },
  { id: 'pokryshkin', name: 'Alexander Pokryshkin', category: 'air', rarity: 'common', nation: 'Soviet Union', bio: 'Fighter ace who shaped Soviet air tactics.' },
  { id: 'weizman', name: 'Ezer Weizman', category: 'air', rarity: 'rare', nation: 'Israel', bio: 'Built up the Israeli Air Force and commanded it in the 1960s.' },
  { id: 'lemay', name: 'Curtis LeMay', category: 'air', rarity: 'epic', nation: 'United States', bio: 'Built Strategic Air Command into the main US bomber force.' },
  { id: 'burke', name: 'Arleigh Burke', category: 'naval', rarity: 'common', nation: 'United States', bio: 'Destroyer commander; served as Chief of Naval Operations 1955-61.' },
  { id: 'gorshkov', name: 'Sergey Gorshkov', category: 'naval', rarity: 'rare', nation: 'Soviet Union', bio: 'Built the Soviet fleet into an ocean-going navy.' },
  { id: 'rickover', name: 'Hyman Rickover', category: 'naval', rarity: 'epic', nation: 'United States', bio: 'Drove the development of nuclear-powered ships.' },
  { id: 'bradley', name: 'Omar Bradley', category: 'strategist', rarity: 'common', nation: 'United States', bio: 'First Chairman of the Joint Chiefs of Staff.' },
  { id: 'vasilevsky', name: 'Aleksandr Vasilevsky', category: 'strategist', rarity: 'rare', nation: 'Soviet Union', bio: 'Chief of the Soviet General Staff and later defence minister.' },
  { id: 'macarthur', name: 'Douglas MacArthur', category: 'strategist', rarity: 'epic', nation: 'United States', bio: 'Commanded the Allied occupation of Japan and UN forces in Korea.' },
];

export const GENERAL_BY_ID: Record<string, GeneralDef> = Object.fromEntries(GENERALS.map((g) => [g.id, g]));

/** Generals every country starts with. */
export const STARTER_GENERALS = ['ridgway', 'abrams', 'bradley'];

/** Collectible fragments needed to recruit a general. */
export const GENERAL_FRAGMENTS_NEEDED: Record<GeneralRarity, number> = { common: 5, rare: 10, epic: 20 };
/** Combat bonus in percent at level 1. Each further level adds GENERAL_LEVEL_BONUS. */
export const GENERAL_PASSIVE_PERCENT: Record<GeneralRarity, number> = { common: 4, rare: 6, epic: 8 };
export const GENERAL_LEVEL_BONUS = 1;
/** Active ability bonus in percent, while it lasts. */
export const GENERAL_ACTIVE_PERCENT: Record<GeneralRarity, number> = { common: 10, rare: 15, epic: 20 };
/** Game seconds. Divided by GAME_SPEED on the server. */
export const GENERAL_ACTIVE_SECONDS = 2 * 3600;
export const GENERAL_COOLDOWN_SECONDS = 12 * 3600;
/** A general whose army was destroyed cannot be deployed for this long. */
export const GENERAL_DEFEAT_LOCK_SECONDS = 24 * 3600;

export const GENERAL_SLOTS = 5;
/** Total XP needed for level 1..5. */
export const GENERAL_LEVEL_XP = [0, 100, 300, 600, 1000];
export const GENERAL_XP_WIN = 100;
export const GENERAL_XP_LOSS = 40;
export const GENERAL_XP_WALKOVER = 20;
/** One free recruitment fragment may be claimed this often (stand-in until the missions update). */
export const GENERAL_DISPATCH_SECONDS = 20 * 3600;
