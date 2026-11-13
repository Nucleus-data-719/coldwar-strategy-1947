import type {
  DiplomacyStateDto,
  PartialResources,
  GeneralsStateDto,
  BattleReportDto,
  WarDto,
  CampaignSummary,
  GameState,
  LobbyCountry,
  NotificationDto,
  ProvinceDetail,
  PublicUser,
  BuildingType,
  UnitType,
} from '@cw/shared';

const BASE: string = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? message);
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  me: async (): Promise<PublicUser | null> => {
    try {
      return (await request<{ user: PublicUser }>('/auth/me')).user;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  },
  register: (username: string, password: string, inviteCode?: string) =>
    post<{ user: PublicUser }>('/auth/register', { username, password, inviteCode: inviteCode || undefined }),
  login: (username: string, password: string) => post<{ user: PublicUser }>('/auth/login', { username, password }),
  logout: () => post<{ ok: true }>('/auth/logout'),

  campaigns: () => request<CampaignSummary[]>('/campaigns'),
  createCampaign: (name: string) => post<{ id: string; name: string }>('/campaigns', { name }),
  lobby: (campaignId: string) => request<LobbyCountry[]>(`/campaigns/${campaignId}/lobby`),
  join: (campaignId: string, countryId: string) => post<{ ok: true }>(`/campaigns/${campaignId}/join`, { countryId }),

  state: (campaignId: string) => request<GameState>(`/campaigns/${campaignId}/state`),
  province: (campaignId: string, provinceId: string) =>
    request<ProvinceDetail>(`/campaigns/${campaignId}/provinces/${provinceId}`),
  build: (campaignId: string, provinceId: string, type: BuildingType) =>
    post<{ ok: true }>(`/campaigns/${campaignId}/provinces/${provinceId}/buildings`, { type }),

  moveFormation: (
    campaignId: string,
    formationId: string,
    provinceId: string,
    units?: Partial<Record<UnitType, number>>,
    waypoint?: boolean,
    point?: { x: number; y: number } | null,
    declareWar?: boolean,
  ) =>
    post<{ ok: true; formationId: string; etaSeconds: number }>(
      `/campaigns/${campaignId}/formations/${formationId}/move`,
      { provinceId, units, waypoint, point: point ?? undefined, declareWar: declareWar || undefined },
    ),
  assignFront: (campaignId: string, formationId: string, countryId: string | null) =>
    post<{ ok: true; assigned: number; provinces: string[] }>(`/campaigns/${campaignId}/formations/${formationId}/front`, { countryId }),
  delayFormation: (campaignId: string, formationId: string, hours: number) =>
    post<{ ok: true }>(`/campaigns/${campaignId}/formations/${formationId}/delay`, { hours }),
  patrolFormation: (
    campaignId: string,
    formationId: string,
    provinceId: string,
    units?: Partial<Record<UnitType, number>>,
  ) =>
    post<{ ok: true; formationId: string; etaSeconds: number }>(
      `/campaigns/${campaignId}/formations/${formationId}/patrol`,
      { provinceId, units },
    ),
  sailFormation: (
    campaignId: string,
    formationId: string,
    dest: { provinceId?: string; node?: number },
    units?: Partial<Record<UnitType, number>>,
  ) =>
    post<{ ok: true; formationId: string; etaSeconds: number }>(
      `/campaigns/${campaignId}/formations/${formationId}/sail`,
      { ...dest, units },
    ),
  navalAttack: (campaignId: string, formationId: string, targetId: string, units?: Partial<Record<UnitType, number>>) =>
    post<{ ok: true; formationId: string; etaSeconds: number }>(
      `/campaigns/${campaignId}/formations/${formationId}/naval-attack`,
      { targetId, units },
    ),
  layMines: (campaignId: string, formationId: string) =>
    post<{ ok: true; strength: number }>(`/campaigns/${campaignId}/formations/${formationId}/lay-mines`),
  stopFormation: (campaignId: string, formationId: string) =>
    post<{ ok: true }>(`/campaigns/${campaignId}/formations/${formationId}/stop`),

  produce: (campaignId: string, provinceId: string, unitType: UnitType, quantity: number) =>
    post<{ ok: true }>(`/campaigns/${campaignId}/provinces/${provinceId}/production`, { unitType, quantity }),
  cancelProduction: (campaignId: string, orderId: string) =>
    post<{ ok: true }>(`/campaigns/${campaignId}/production/${orderId}/cancel`),
  mergeFormation: (campaignId: string, formationId: string, intoId: string) =>
    post<{ ok: true }>(`/campaigns/${campaignId}/formations/${formationId}/merge`, { intoId }),
  splitFormation: (campaignId: string, formationId: string, units: Partial<Record<UnitType, number>>) =>
    post<{ ok: true }>(`/campaigns/${campaignId}/formations/${formationId}/split`, { units }),
  moveCapital: (campaignId: string, provinceId: string) =>
    post<{ ok: true; completesAt: string }>(`/campaigns/${campaignId}/capital`, { provinceId }),

  startResearch: (campaignId: string, techId: string) =>
    post<{ ok: true; completesAt: string }>(`/campaigns/${campaignId}/research`, { techId }),
  cancelResearch: (campaignId: string) => post<{ ok: true }>(`/campaigns/${campaignId}/research/cancel`),

  generals: (campaignId: string) => request<GeneralsStateDto>(`/campaigns/${campaignId}/generals`),
  claimDispatch: (campaignId: string) =>
    post<{ ok: true; generalId: string; fragments: number; needed: number; recruited: boolean }>(`/campaigns/${campaignId}/generals/dispatch`),
  deployGeneral: (campaignId: string, generalId: string, formationId: string) =>
    post<{ ok: true }>(`/campaigns/${campaignId}/generals/${generalId}/deploy`, { formationId }),
  undeployGeneral: (campaignId: string, generalId: string) =>
    post<{ ok: true }>(`/campaigns/${campaignId}/generals/${generalId}/undeploy`),
  activateGeneral: (campaignId: string, generalId: string) =>
    post<{ ok: true; activeUntil: string }>(`/campaigns/${campaignId}/generals/${generalId}/activate`),

  diplomacy: (campaignId: string) => request<DiplomacyStateDto>(`/campaigns/${campaignId}/diplomacy`),
  proposeAlliance: (campaignId: string, countryId: string) =>
    post<{ ok: true }>(`/campaigns/${campaignId}/diplomacy/alliance`, { countryId }),
  respondAlliance: (campaignId: string, countryId: string, accept: boolean) =>
    post<{ ok: true }>(`/campaigns/${campaignId}/diplomacy/alliance/respond`, { countryId, accept }),
  breakAlliance: (campaignId: string, countryId: string) =>
    post<{ ok: true }>(`/campaigns/${campaignId}/diplomacy/alliance/break`, { countryId }),
  joinCall: (campaignId: string, callId: string) => post<{ ok: true }>(`/campaigns/${campaignId}/diplomacy/calls/${callId}/join`),
  declineCall: (campaignId: string, callId: string) => post<{ ok: true }>(`/campaigns/${campaignId}/diplomacy/calls/${callId}/decline`),
  sendAid: (campaignId: string, countryId: string, gift: PartialResources) =>
    post<{ ok: true; opinionGain: number }>(`/campaigns/${campaignId}/diplomacy/assist`, { countryId, gift }),

  feedback: (message: string, campaignId?: string, context?: Record<string, unknown>) =>
    post<{ ok: true }>('/feedback', { message, campaignId, context }),

  wars: (campaignId: string) => request<WarDto[]>(`/campaigns/${campaignId}/wars`),
  declareWar: (campaignId: string, countryId: string) =>
    post<{ ok: true }>(`/campaigns/${campaignId}/wars`, { countryId }),
  battles: (campaignId: string) => request<BattleReportDto[]>(`/campaigns/${campaignId}/battles`),

  notifications: (campaignId: string) => request<NotificationDto[]>(`/campaigns/${campaignId}/notifications`),
  readNotifications: (campaignId: string) => post<{ ok: true }>(`/campaigns/${campaignId}/notifications/read`),
};
