import type {
  BuildingStatus,
  BuildingType,
  Resources,
  Terrain,
  UnitType,
} from './types';

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
  resources: { balance: Resources; rates: Resources };
  serverTime: string;
}

export interface MovementDto {
  /** Province the army is currently travelling into. */
  toKey: string;
  /** Provinces still to cross after `toKey`. */
  remainingKeys: string[];
  startedAt: string;
  arrivesAt: string;
}

export interface FormationDto {
  id: string;
  name: string;
  countryId: string;
  /** Last province fully reached. While moving, this is where the current leg started. */
  provinceKey: string;
  units: { unitType: UnitType; count: number }[];
  movement: MovementDto | null;
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
}

export interface NotificationDto {
  id: string;
  type: string;
  message: string;
  read: boolean;
  createdAt: string;
}
