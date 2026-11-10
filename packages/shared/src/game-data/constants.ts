import type { Resources, UnitType } from '../types';

export const STARTING_RESOURCES: Resources = {
  money: 5000,
  food: 3000,
  oil: 500,
  steel: 1000,
  electronics: 100,
  rare: 50,
  manpower: 20000,
};

/** Every country keeps one standing formation per province with this name. */
export const GARRISON_NAME = 'Garrison';
/** Infantry placed in every capital when a campaign is created. */
export const STARTING_GARRISON = 5;
/** What recruitment centers produce. */
export const RECRUIT_UNIT: UnitType = 'infantry';
/** Infantry placed in every other province when a campaign is created, so land is defended. */
export const STARTING_PROVINCE_GARRISON = 2;
/** After capture a province produces nothing for this long (game seconds). */
export const OCCUPATION_DISRUPTION_SECONDS = 6 * 3600;
/** Share of the loser's stockpile the captor takes when a capital falls. */
export const CAPITAL_LOOT_SHARE = 0.15;
export const CAPITAL_STABILITY_LOSS = 20;
/** Money kept in reserve by the AI before it spends on construction. */
export const AI_MONEY_RESERVE = 400;
