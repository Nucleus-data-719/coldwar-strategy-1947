import type { PartialResources, ResourceKey, Resources, UnitType } from '../types';

export const STARTING_RESOURCES: Resources = {
  money: 5000,
  food: 3000,
  oil: 500,
  steel: 1000,
  electronics: 100,
  rare: 50,
  wood: 400,
  manpower: 20000,
};

/** Every country keeps one standing formation per province with this name. */
export const GARRISON_NAME = 'Garrison';
/** Infantry placed in every city (the capital included) when a campaign is created. Other provinces start empty. */
export const STARTING_GARRISON = 5;
/** What recruitment centers produce. */
export const RECRUIT_UNIT: UnitType = 'infantry';
/** After capture a province produces nothing for this long (game seconds). */
export const OCCUPATION_DISRUPTION_SECONDS = 6 * 3600;
/** Share of the loser's stockpile the captor takes when a capital falls. */
export const CAPITAL_LOOT_SHARE = 0.15;
export const CAPITAL_STABILITY_LOSS = 20;
/** Money kept in reserve by the AI before it spends on construction. */
export const AI_MONEY_RESERVE = 400;

/** Out-of-supply penalty to attack and defence in battle, per resource that has run out while still being used up. */
export const SUPPLY_PENALTY_PERCENT: Partial<Record<ResourceKey, number>> = { oil: 20, food: 20, money: 10 };
/** Factories take at most this many queued units per province, and this many per order. */
export const FACTORY_QUEUE_LIMIT = 20;
export const MAX_ORDER_QUANTITY = 10;
/** Moving the capital: price, and how long the old capital stays in place (game seconds). */
export const CAPITAL_MOVE_COST: PartialResources = { money: 2000, steel: 500 };
export const CAPITAL_MOVE_SECONDS = 24 * 3600;
/** Province defence value of a capital. */
export const CAPITAL_DEFENSE = 20;
export const PROVINCE_DEFENSE = 10;
