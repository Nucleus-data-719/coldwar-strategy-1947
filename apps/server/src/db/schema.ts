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
  startYear: integer('start_year').notNull().default(1947),
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
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('formations_province_idx').on(t.provinceId),
    index('formations_country_idx').on(t.countryId),
    index('formations_move_idx').on(t.moveArrivesAt),
  ],
);

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

export type UserRow = typeof users.$inferSelect;
export type CampaignRow = typeof campaigns.$inferSelect;
export type CountryRow = typeof countries.$inferSelect;
export type PlayerRow = typeof players.$inferSelect;
export type ProvinceRow = typeof provinces.$inferSelect;
export type BuildingRow = typeof buildings.$inferSelect;
export type FormationRow = typeof formations.$inferSelect;
export type FormationUnitRow = typeof formationUnits.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
