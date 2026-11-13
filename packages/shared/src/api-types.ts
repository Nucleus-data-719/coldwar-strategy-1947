import type { BattleModifier, BattleRoundLog } from './combat';
import type { RelationStage } from './game-data/diplomacy';
import type {
  BuildingStatus,
  BuildingType,
  ResourceKey,
  Resources,
  Terrain,
  UnitType,
} from './types';

export interface BattleSideReport {
  countryId: string;
  countryName: string;
  formations: string[];
  before: { unitType: UnitType; count: number }[];
  after: { unitType: UnitType; count: number }[];
}

/** What is stored for a battle. `walkover` means the province had no defenders. */
export interface BattleReportData {
  provinceKey: string;
  provinceName: string;
  terrain: Terrain;
  seed: number;
  attacker: BattleSideReport;
  defender: BattleSideReport;
  modifiers: BattleModifier[];
  rounds: BattleRoundLog[];
  summary: string[];
  capturedProvince: boolean;
  capturedCapital: boolean;
  /** What happened to the attacking army afterwards. */
  attackerFate: 'advanced' | 'retreated' | 'destroyed';
}

export interface BattleReportDto extends BattleReportData {
  id: string;
  createdAt: string;
  outcome: 'attacker_won' | 'defender_held' | 'walkover';
}

export interface PublicUser {
  id: string;
  username: string;
}

export interface CampaignSummary {
  id: string;
  name: string;
  startYear: number;
  playerCount: number;
  myCountryId: string | null;
}

export interface LobbyCountry {
  id: string;
  code: string;
  name: string;
  color: string;
  isPlayable: boolean;
  claimed: boolean;
  provinceCount: number;
  blurb: string;
}

export interface StateCountry {
  id: string;
  code: string;
  name: string;
  color: string;
  isPlayable: boolean;
  aiControlled: boolean;
  provinceCount: number;
  capitalProvinceKey: string | null;
}

export interface BuildingDto {
  type: BuildingType;
  status: BuildingStatus;
  startedAt: string;
  completesAt: string;
  /** Bomb damage in percent. At 50% or more the building stops working until repaired. */
  damage: number;
}

export interface StateProvince {
  id: string;
  key: string;
  ownerCountryId: string;
  buildings: BuildingDto[];
  unitCount: number;
}

export interface GameState {
  campaign: { id: string; name: string; startYear: number; gameSpeed: number };
  me: { countryId: string; username: string };
  countries: StateCountry[];
  provinces: StateProvince[];
  /** Your own armies, including those on the move. */
  formations: FormationDto[];
  /** Enemy fleets at sea that your ships and coasts can see. */
  enemies?: EnemyFleetDto[];
  /** Your own mine fields, and enemy ones your destroyers and corvettes have found. */
  mines?: SeaMineDto[];
  /** Ids of the countries you are at war with. */
  atWarWith: string[];
  resources: { balance: Resources; rates: Resources; shortages: ResourceKey[]; breakdown: RateBreakdown };
  research: ResearchStateDto;
  /** A capital move in progress, if any. */
  capitalMove: { provinceKey: string; completesAt: string } | null;
  serverTime: string;
}

/** Where each hourly rate comes from. `net` is what the top bar shows. */
export interface RateBreakdown {
  /** What your provinces produce on their own. */
  provinces: Resources;
  /** Extra from completed buildings such as Local Factories. */
  buildings: Resources;
  /** Extra from industry research (money and strategic resources only). */
  research: Resources;
  /** Hourly cost of keeping units. */
  upkeep: Resources;
  provinceCount: number;
  /** Captured provinces that are not producing yet. */
  disruptedCount: number;
  researchPercent: number;
  net: Resources;
}

export interface MovementDto {
  /** Province the army is currently travelling into. */
  toKey: string;
  /** Provinces still to cross after `toKey`. */
  remainingKeys: string[];
  startedAt: string;
  arrivesAt: string;
  /** The aircraft are flying out to start a patrol. */
  patrol?: boolean;
  /** The army is waiting (delayed) until this time, standing `holdFraction` of the way along its leg. */
  holdUntil?: string | null;
  holdFraction?: number;
}

/** An air force holding a patrol over a province. */
export interface PatrolDto {
  provinceKey: string;
  /** Radius of the patrol circle in map units. */
  radius: number;
  since: string;
}

export interface FormationDto {
  id: string;
  name: string;
  countryId: string;
  /** Last province fully reached. While moving, this is where the current leg started. */
  provinceKey: string;
  units: { unitType: UnitType; count: number }[];
  movement: MovementDto | null;
  /** Set while the aircraft are on patrol. */
  patrol?: PatrolDto | null;
  /** Id of the general leading this army, if any (yours only). */
  generalId?: string | null;
  /** Set while the fleet is at sea (not in a port). */
  sea?: SeaPositionDto | null;
  /** The spot inside the province where the army was told to stand, if any. */
  rest?: { x: number; y: number } | null;
  /** Set when the army holds the front against this country. */
  frontCountryId?: string | null;
}

/** A fleet at sea. `node` is the dot it is at (or left from, on a voyage). */
export interface SeaPositionDto {
  node: number;
  voyage: {
    nodes: number[];
    startedAt: string;
    arrivesAt: string;
    /** The port the fleet is sailing into, if any. */
    destKey: string | null;
    /** The enemy fleet it is hunting, if any. */
    attackTargetId: string | null;
  } | null;
}

/** An enemy fleet you can currently see. Ships are shown without their make-up unless a hunter has them in sight. */
export interface EnemyFleetDto {
  id: string;
  countryId: string;
  node: number;
  /** Where it is heading, if it is on a voyage and you can tell. */
  toNode: number | null;
  /** Rough size, in ships. */
  ships: number;
  /** Submarines only show up when your destroyers or corvettes have spotted them. */
  submarines: boolean;
}

export interface SeaMineDto {
  id: string;
  countryId: string;
  node: number;
  strength: number;
  expiresAt: string;
  mine: boolean;
}

export interface ProvinceDetail {
  id: string;
  key: string;
  name: string;
  terrain: Terrain;
  isCoastal: boolean;
  isCapital: boolean;
  buildingSlots: number;
  defense: number;
  population: number;
  production: Resources;
  ownerCountryId: string;
  ownerName: string;
  buildings: BuildingDto[];
  formations: FormationDto[];
  /** Set while a captured province produces nothing. */
  disruptedUntil: string | null;
  /** Units waiting in this province's military factory (yours only). */
  productionQueue: ProductionOrderDto[];
}

export interface ProductionOrderDto {
  id: string;
  unitType: UnitType;
  /** 'building' is the unit in production; the rest are waiting. */
  status: 'building' | 'queued';
  completesAt: string | null;
}

export interface ResearchStateDto {
  done: string[];
  active: { techId: string; startedAt: string; completesAt: string } | null;
  labs: number;
  universities: number;
  /** Research speed bonus in percent, after the cap. */
  speedPercent: number;
  /** Before the cap. Higher than speedPercent when the cap is limiting you. */
  rawSpeedPercent: number;
  productionPercent: number;
  combatPercent: number;
  unlockedUnits: UnitType[];
}

export interface GeneralDto {
  generalId: string;
  unlocked: boolean;
  fragments: number;
  xp: number;
  level: number;
  deployedFormationId: string | null;
  /** Set after his army was destroyed. */
  lockedUntil: string | null;
  abilityActiveUntil: string | null;
  abilityReadyAt: string | null;
}

export interface GeneralsStateDto {
  generals: GeneralDto[];
  deployed: number;
  slots: number;
  /** When the next free fragment can be claimed; null means now. */
  nextDispatchAt: string | null;
}

export type AllianceState = 'none' | 'proposed_by_you' | 'proposed_to_you' | 'active';

export interface DiplomacyCountryDto {
  countryId: string;
  name: string;
  color: string;
  aiControlled: boolean;
  /** -100 to 100, how this country feels about you (the same number both ways). */
  opinion: number;
  stage: RelationStage;
  alliance: AllianceState;
  atWar: boolean;
}

/** An ally asks for help because a country it is allied with was attacked. */
export interface WarCallDto {
  id: string;
  /** The attacked ally. */
  defenderId: string;
  defenderName: string;
  aggressorId: string;
  aggressorName: string;
  /** You join the war automatically at this time unless you decline. */
  joinsAt: string;
}

export interface DiplomacyStateDto {
  countries: DiplomacyCountryDto[];
  calls: WarCallDto[];
  allianceCount: number;
  maxAlliances: number;
}

export interface WarDto {
  id: string;
  enemyCountryId: string;
  enemyName: string;
  declaredAt: string;
  /** True when you declared it. */
  declaredByYou: boolean;
}

export interface NotificationDto {
  id: string;
  type: string;
  message: string;
  read: boolean;
  createdAt: string;
}
