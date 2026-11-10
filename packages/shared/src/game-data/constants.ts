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
/** Money kept in reserve by the AI before it spends on construction. */
export const AI_MONEY_RESERVE = 400;
