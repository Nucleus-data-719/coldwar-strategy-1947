import type { PartialResources, UnitType } from '../types';

export type ResearchBranch = 'infantry' | 'armor' | 'air' | 'naval' | 'industry';

export const RESEARCH_BRANCHES: { id: ResearchBranch; name: string; blurb: string }[] = [
  { id: 'infantry', name: 'Infantry & Doctrine', blurb: 'Better tactics: every unit fights harder.' },
  { id: 'armor', name: 'Armour', blurb: 'Tanks, and the doctrine to use them.' },
  { id: 'air', name: 'Air Force', blurb: 'Fighters, bombers and air support.' },
  { id: 'naval', name: 'Navy', blurb: 'Warships, mines and submarines.' },
  { id: 'industry', name: 'Industry', blurb: 'More output and faster research.' },
];

export interface TechEffect {
  /** Units a factory may build once this is researched. */
  unlock?: UnitType[];
  /** Added to all resource production of the country, in percent. */
  productionPercent?: number;
  /** Added to attack and defence of all your armies in battle, in percent. */
  combatPercent?: number;
  /** Added to research speed, in percent (counts toward the speed cap). */
  researchSpeedPercent?: number;
}

export interface TechDef {
  id: string;
  name: string;
  branch: ResearchBranch;
  /** 1 to 5. A tech's prerequisites are always of a lower tier. */
  tier: number;
  era: string;
  description: string;
  requires: string[];
  cost: PartialResources;
  /** Base seconds, before research speed and game speed. */
  baseSeconds: number;
  effect: TechEffect;
}

const TIERS: Record<number, { era: string; cost: PartialResources; seconds: number }> = {
  1: { era: '1947', cost: { money: 600, electronics: 20 }, seconds: 2 * 3600 },
  2: { era: '1955', cost: { money: 1200, electronics: 50, steel: 100 }, seconds: 4 * 3600 },
  3: { era: '1965', cost: { money: 2200, electronics: 100, steel: 200 }, seconds: 8 * 3600 },
  4: { era: '1975', cost: { money: 3500, electronics: 160, steel: 300, rare: 20 }, seconds: 16 * 3600 },
  5: { era: '1985', cost: { money: 5000, electronics: 240, steel: 400, rare: 40 }, seconds: 24 * 3600 },
};

function tech(
  id: string,
  branch: ResearchBranch,
  tier: number,
  name: string,
  description: string,
  requires: string[],
  effect: TechEffect,
): TechDef {
  const t = TIERS[tier];
  return { id, name, branch, tier, era: t.era, description, requires, cost: t.cost, baseSeconds: t.seconds, effect };
}

export const TECHS: TechDef[] = [
  // Infantry & doctrine
  tech('inf_1', 'infantry', 1, 'Combined Arms Doctrine', 'Infantry, artillery and armour trained together.', [], { combatPercent: 4 }),
  tech('inf_2', 'infantry', 2, 'Automatic Rifles', 'Standard-issue automatic weapons.', ['inf_1'], { combatPercent: 4 }),
  tech('inf_3', 'infantry', 3, 'Airmobile Tactics', 'Helicopter-borne reserves and rapid redeployment.', ['inf_2', 'air_1'], { combatPercent: 4 }),
  tech('inf_4', 'infantry', 4, 'Mechanised Infantry', 'Armoured carriers for every infantry unit.', ['inf_3', 'armor_2'], { combatPercent: 4 }),
  tech('inf_5', 'infantry', 5, 'AirLand Battle', 'One integrated battle plan for ground and air forces.', ['inf_4', 'air_3'], { combatPercent: 4 }),

  // Armour
  tech('armor_1', 'armor', 1, 'Light Tanks', 'Fast, lightly armoured tanks. Unlocks them in the Military Factory.', [], { unlock: ['light_tank'] }),
  tech('armor_2', 'armor', 2, 'Heavy Tanks', 'Slow, heavily armoured breakthrough tanks. Unlocks them in the Military Factory.', ['armor_1'], { unlock: ['heavy_tank'] }),
  tech('armor_3', 'armor', 3, 'Composite Armour', 'Layered armour that shrugs off shaped charges.', ['armor_2'], { combatPercent: 3 }),
  tech('armor_4', 'armor', 4, 'Main Battle Tank', 'One tank design replaces the light and heavy classes.', ['armor_3', 'ind_2'], { combatPercent: 4 }),
  tech('armor_5', 'armor', 5, 'Fire-Control Computers', 'Tanks hit first, and hit what they aim at.', ['armor_4', 'ind_3'], { combatPercent: 4 }),

  // Air force
  tech('air_1', 'air', 1, 'Fighter Aircraft', 'Jet and piston fighters. Production arrives with the air update.', [], { unlock: ['fighter'] }),
  tech('air_2', 'air', 2, 'Strategic Bombers', 'Long-range bombers. Production arrives with the air update.', ['air_1'], { unlock: ['bomber'] }),
  tech('air_3', 'air', 3, 'Close Air Support', 'Aircraft that fly with the army. Production arrives with the air update.', ['air_2', 'ind_2'], { unlock: ['air_support'] }),
  tech('air_4', 'air', 4, 'Radar Networks', 'Early warning over the whole front.', ['air_3'], { combatPercent: 4 }),
  tech('air_5', 'air', 5, 'Precision Strike', 'Guided weapons: fewer sorties, more hits.', ['air_4'], { combatPercent: 4 }),

  // Navy
  tech('naval_1', 'naval', 1, 'Destroyers and Corvettes', 'Fast escorts that hunt submarines and lay mines.', [], { unlock: ['destroyer', 'corvette'] }),
  tech('naval_2', 'naval', 2, 'Submarines', 'Submarines: hidden from most ships, they lay mines and strike close.', ['naval_1'], { unlock: ['submarine'] }),
  tech('naval_3', 'naval', 3, 'Cruisers', 'Heavy surface escorts.', ['naval_2', 'ind_2'], { unlock: ['cruiser'] }),
  tech('naval_4', 'naval', 4, 'Battleships', 'Capital ships that shell the enemy from two sea lanes away.', ['naval_3'], { unlock: ['battleship'] }),
  tech('naval_5', 'naval', 5, 'Sonar and Missiles', 'Detect submarines, and answer them.', ['naval_4'], { combatPercent: 4 }),

  // Industry
  tech('ind_1', 'industry', 1, 'Assembly Lines', 'Standardised parts and shift work: +5% industrial output.', [], { productionPercent: 5 }),
  tech('ind_2', 'industry', 2, 'Electronics Industry', 'Radio, radar and early computers: +5% industrial output.', ['ind_1'], { productionPercent: 5 }),
  tech('ind_3', 'industry', 3, 'Automation', 'Machines do the repetitive work: +5% industrial output.', ['ind_2'], { productionPercent: 5 }),
  tech('ind_4', 'industry', 4, 'Research Institutes', 'State-funded science: +15% research speed.', ['ind_2'], { researchSpeedPercent: 15 }),
  tech('ind_5', 'industry', 5, 'Mainframe Computers', 'Planning by computer: +5% industrial output.', ['ind_3', 'ind_4'], { productionPercent: 5 }),
];

export const TECH_BY_ID: Record<string, TechDef> = Object.fromEntries(TECHS.map((t) => [t.id, t]));

/** Units every country can build without research. */
export const BASE_UNLOCKED_UNITS: UnitType[] = ['infantry', 'artillery'];

/** Each research laboratory and university adds this much research speed, in percent. */
export const RESEARCH_LAB_BONUS = 15;
export const UNIVERSITY_BONUS = 25;
/** Hard cap on total research speed bonus, in percent. Nothing, including money, goes beyond it. */
export const RESEARCH_SPEED_CAP = 100;
/** Share of the price returned when you cancel a running project. */
export const RESEARCH_CANCEL_REFUND = 0.5;
