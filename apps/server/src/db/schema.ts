import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  BattleReportData,
  BuildingStatus,
  BuildingType,
  Resources,
  Terrain,
  UnitType,
} from '@cw/shared';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    usernameKey: text('username_key').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_username_key_idx').on(t.usernameKey)],
);

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  startYear: integer('start_year').notNull().default(1950),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// Column names match ResourceKey so rows convert to/from Resources directly.
const resourceColumns = {
  money: doublePrecision('money').notNull().default(0),
  food: doublePrecision('food').notNull().default(0),
  oil: doublePrecision('oil').notNull().default(0),
  steel: doublePrecision('steel').notNull().default(0),
  electronics: doublePrecision('electronics').notNull().default(0),
  rare: doublePrecision('rare').notNull().default(0),
  wood: doublePrecision('wood').notNull().default(0),
  manpower: doublePrecision('manpower').notNull().default(0),
};

export const countries = pgTable(
  'countries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    isPlayable: boolean('is_playable').notNull().default(false),
    aiControlled: boolean('ai_controlled').notNull().default(true),
    stability: integer('stability').notNull().default(70),
    capitalProvinceId: uuid('capital_province_id'),
    // A capital move in progress: the new capital takes over at capitalMoveAt.
    capitalMoveProvinceId: uuid('capital_move_province_id'),
    capitalMoveAt: ts('capital_move_at'),
    ...resourceColumns,
    resourcesUpdatedAt: ts('resources_updated_at').notNull().defaultNow(),
    aiNextDecisionAt: ts('ai_next_decision_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('countries_campaign_code_idx').on(t.campaignId, t.code),
    index('countries_ai_idx').on(t.aiControlled, t.aiNextDecisionAt),
  ],
);

export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('players_user_campaign_idx').on(t.userId, t.campaignId),
    uniqueIndex('players_country_idx').on(t.countryId),
  ],
);

export const provinces = pgTable(
  'provinces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    ownerCountryId: uuid('owner_country_id')
      .notNull()
      .references(() => countries.id),
    terrain: text('terrain').$type<Terrain>().notNull(),
    isCoastal: boolean('is_coastal').notNull().default(false),
    buildingSlots: integer('building_slots').notNull().default(3),
    defense: integer('defense').notNull().default(10),
    population: integer('population').notNull().default(0),
    production: jsonb('production').$type<Resources>().notNull(),
    // Set when a province is captured: it produces nothing until this time.
    disruptedUntil: ts('disrupted_until'),
  },
  (t) => [
    uniqueIndex('provinces_campaign_key_idx').on(t.campaignId, t.key),
    index('provinces_owner_idx').on(t.ownerCountryId),
  ],
);

export const buildings = pgTable(
  'buildings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    provinceId: uuid('province_id')
      .notNull()
      .references(() => provinces.id, { onDelete: 'cascade' }),
    type: text('type').$type<BuildingType>().notNull(),
    status: text('status').$type<BuildingStatus>().notNull(),
    startedAt: ts('started_at').notNull().defaultNow(),
    completesAt: ts('completes_at').notNull(),
    nextActionAt: ts('next_action_at'),
    // Bomb damage (0-100) and when it last changed (repairs run from there).
    damage: integer('damage').notNull().default(0),
    damageUpdatedAt: ts('damage_updated_at'),
  },
  (t) => [
    uniqueIndex('buildings_province_type_idx').on(t.provinceId, t.type),
    index('buildings_status_idx').on(t.status, t.completesAt),
    index('buildings_campaign_idx').on(t.campaignId),
  ],
);

export const formations = pgTable(
  'formations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    provinceId: uuid('province_id')
      .notNull()
      .references(() => provinces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Movement. `provinceId` is the last province fully reached. While moving, the army is
    // travelling into `moveNextProvinceId` and arrives at `moveArrivesAt`; `movePath` lists
    // the provinces still to cross after that one.
    moveNextProvinceId: uuid('move_next_province_id').references(() => provinces.id, { onDelete: 'set null' }),
    movePath: jsonb('move_path').$type<string[]>().notNull().default([]),
    moveStartedAt: ts('move_started_at'),
    moveArrivesAt: ts('move_arrives_at'),
    // Air patrol: `movePatrol` means the current flight ends in a patrol; `patrolActive` means the
    // aircraft are holding one over `provinceId`. Effects are settled up to `patrolSettledAt`.
    movePatrol: boolean('move_patrol').notNull().default(false),
    patrolActive: boolean('patrol_active').notNull().default(false),
    patrolSince: ts('patrol_since'),
    patrolSettledAt: ts('patrol_settled_at'),
    // Naval: `seaNode` is the open-sea dot the fleet is at (or, during a voyage, left from); null when in port.
    // A voyage follows the dots in `seaPath` and ends at `seaArrivesAt`, in port `seaDestProvinceId` if set.
    // A delayed army waits where it is until `moveHoldUntil`; `moveHoldFraction` is how far along the leg it stands.
    moveHoldUntil: ts('move_hold_until'),
    moveHoldFraction: doublePrecision('move_hold_fraction'),
    seaNode: integer('sea_node'),
    seaPath: jsonb('sea_path').$type<number[]>().notNull().default([]),
    seaStartedAt: ts('sea_started_at'),
    seaArrivesAt: ts('sea_arrives_at'),
    seaDestProvinceId: uuid('sea_dest_province_id').references(() => provinces.id, { onDelete: 'set null' }),
    attackTargetId: uuid('attack_target_id'),
    // Where in the province the army stands (map units); null means the usual spot.
    restX: doublePrecision('rest_x'),
    restY: doublePrecision('rest_y'),
    // Set when the army was assigned to the front against this country: it holds the border and attacks when war comes.
    frontCountryId: uuid('front_country_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('formations_sea_idx').on(t.seaArrivesAt),
    index('formations_province_idx').on(t.provinceId),
    index('formations_country_idx').on(t.countryId),
    index('formations_move_idx').on(t.moveArrivesAt),
  ],
);

export const seaMines = pgTable(
  'sea_mines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    node: integer('node').notNull(),
    strength: integer('strength').notNull(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('sea_mines_campaign_idx').on(t.campaignId, t.node)],
);
export type SeaMineRow = typeof seaMines.$inferSelect;

export const formationUnits = pgTable(
  'formation_units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formationId: uuid('formation_id')
      .notNull()
      .references(() => formations.id, { onDelete: 'cascade' }),
    unitType: text('unit_type').$type<UnitType>().notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [uniqueIndex('formation_units_idx').on(t.formationId, t.unitType)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    message: text('message').notNull(),
    read: boolean('read').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('notifications_country_idx').on(t.countryId, t.createdAt)],
);

export const productionOrders = pgTable(
  'production_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    // The province with the military factory.
    provinceId: uuid('province_id')
      .notNull()
      .references(() => provinces.id, { onDelete: 'cascade' }),
    unitType: text('unit_type').$type<UnitType>().notNull(),
    position: integer('position').notNull(),
    // Set only on the unit currently being built.
    completesAt: ts('completes_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('production_orders_province_idx').on(t.provinceId, t.position),
    index('production_orders_due_idx').on(t.completesAt),
  ],
);

export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    message: text('message').notNull(),
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('feedback_created_idx').on(t.createdAt)],
);

export const research = pgTable(
  'research',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    techId: text('tech_id').notNull(),
    status: text('status').$type<'active' | 'done'>().notNull(),
    startedAt: ts('started_at').notNull().defaultNow(),
    completesAt: ts('completes_at').notNull(),
  },
  (t) => [
    uniqueIndex('research_country_tech_idx').on(t.countryId, t.techId),
    index('research_due_idx').on(t.status, t.completesAt),
  ],
);

export const generals = pgTable(
  'generals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    generalId: text('general_id').notNull(),
    unlocked: boolean('unlocked').notNull().default(false),
    fragments: integer('fragments').notNull().default(0),
    xp: integer('xp').notNull().default(0),
    deployedFormationId: uuid('deployed_formation_id').references(() => formations.id, { onDelete: 'set null' }),
    lockedUntil: ts('locked_until'),
    abilityActiveUntil: ts('ability_active_until'),
    abilityReadyAt: ts('ability_ready_at'),
  },
  (t) => [
    uniqueIndex('generals_country_general_idx').on(t.countryId, t.generalId),
    uniqueIndex('generals_deployed_idx').on(t.deployedFormationId),
  ],
);

export const generalClaims = pgTable('general_claims', {
  countryId: uuid('country_id')
    .primaryKey()
    .references(() => countries.id, { onDelete: 'cascade' }),
  lastClaimAt: ts('last_claim_at').notNull(),
});

export const wars = pgTable(
  'wars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    aggressorId: uuid('aggressor_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    defenderId: uuid('defender_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    declaredAt: ts('declared_at').notNull().defaultNow(),
    endedAt: ts('ended_at'),
  },
  (t) => [
    index('wars_aggressor_idx').on(t.aggressorId),
    index('wars_defender_idx').on(t.defenderId),
  ],
);

/** How two countries feel about each other. One row per pair, ids stored in sorted order. */
export const relations = pgTable(
  'relations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    countryA: uuid('country_a')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    countryB: uuid('country_b')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    opinion: integer('opinion').notNull().default(0),
  },
  (t) => [uniqueIndex('relations_pair_idx').on(t.countryA, t.countryB)],
);

export const alliances = pgTable(
  'alliances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    countryA: uuid('country_a')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    countryB: uuid('country_b')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    proposedBy: uuid('proposed_by').notNull(),
    status: text('status').$type<'pending' | 'active'>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('alliances_pair_idx').on(t.countryA, t.countryB)],
);

/** A defence call: an ally of the attacked country is asked to join the war. */
export const warCalls = pgTable(
  'war_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    allyId: uuid('ally_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    defenderId: uuid('defender_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    aggressorId: uuid('aggressor_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    status: text('status').$type<'pending' | 'joined' | 'declined' | 'void'>().notNull().default('pending'),
    joinsAt: ts('joins_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('war_calls_ally_target_idx').on(t.allyId, t.defenderId, t.aggressorId),
    index('war_calls_due_idx').on(t.status, t.joinsAt),
  ],
);

export const battleReports = pgTable(
  'battle_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    attackerId: uuid('attacker_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    defenderId: uuid('defender_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    outcome: text('outcome').$type<'attacker_won' | 'defender_held' | 'walkover'>().notNull(),
    data: jsonb('data').$type<BattleReportData>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('battle_reports_attacker_idx').on(t.attackerId, t.createdAt),
    index('battle_reports_defender_idx').on(t.defenderId, t.createdAt),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type CampaignRow = typeof campaigns.$inferSelect;
export type CountryRow = typeof countries.$inferSelect;
export type PlayerRow = typeof players.$inferSelect;
export type ProvinceRow = typeof provinces.$inferSelect;
export type BuildingRow = typeof buildings.$inferSelect;
export type FormationRow = typeof formations.$inferSelect;
export type FormationUnitRow = typeof formationUnits.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type WarRow = typeof wars.$inferSelect;
export type BattleReportRow = typeof battleReports.$inferSelect;
export type ProductionOrderRow = typeof productionOrders.$inferSelect;
export type ResearchRow = typeof research.$inferSelect;
export type GeneralRow = typeof generals.$inferSelect;
export type AllianceRow = typeof alliances.$inferSelect;
export type WarCallRow = typeof warCalls.$inferSelect;
