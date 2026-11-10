import { ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  BUILDINGS,
  COUNTRIES,
  GARRISON_NAME,
  PROVINCES,
  RECRUIT_UNIT,
  STARTING_GARRISON,
  STARTING_PROVINCE_GARRISON,
  STARTING_RESOURCES,
  addResources,
  scaleSeconds,
  type BuildingDto,
  type CampaignSummary,
  type FormationDto,
  type GameState,
  type LobbyCountry,
  type ProvinceDetail,
  type StateCountry,
  type StateProvince,
} from '@cw/shared';
import { COUNTRY_BY_CODE } from '@cw/shared';
import { env } from '../config/env';
import { DB, Db } from '../db/db.module';
import {
  buildings,
  BuildingRow,
  campaigns,
  countries,
  formationUnits,
  formations,
  players,
  provinces,
  users,
} from '../db/schema';
import { EconomyService } from '../economy/economy.service';
import { toFormationDto } from '../military/formation.mapper';
import { PlayersService } from '../players/players.service';
import { RealtimeService } from '../realtime/realtime.service';
import { generals } from '../db/schema';
import { loadResearch, toResearchDto } from '../research/research.queries';
import { ProductionService } from '../production/production.service';
import { WarsService } from '../wars/wars.service';

function toBuildingDto(b: BuildingRow): BuildingDto {
  return {
    type: b.type,
    status: b.status,
    startedAt: b.startedAt.toISOString(),
    completesAt: b.completesAt.toISOString(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

@Injectable()
export class CampaignsService implements OnModuleInit {
  private readonly log = new Logger(CampaignsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly economy: EconomyService,
    private readonly players: PlayersService,
    private readonly realtime: RealtimeService,
    private readonly wars: WarsService,
    private readonly production: ProductionService,
  ) {}

  /** Campaigns made before the real world map (province keys like p0_0) cannot be played any more. */
  private async legacyCampaignIds(): Promise<Set<string>> {
    const rows = await this.db
      .selectDistinct({ id: provinces.campaignId })
      .from(provinces)
      .where(sql`${provinces.key} ~ '^p[0-9]+_[0-9]+$'`);
    return new Set(rows.map((r) => r.id));
  }

  /** Makes sure there is always a playable campaign to join on a fresh database. */
  async onModuleInit() {
    try {
      const legacy = await this.legacyCampaignIds();
      if (legacy.size > 0) {
        this.log.warn(
          `${legacy.size} campaign(s) use the old placeholder map and are hidden. Delete them with: DELETE FROM campaigns WHERE id IN (...) (see docs/week4.sql).`,
        );
      }
      const existing = (await this.db.select({ id: campaigns.id }).from(campaigns)).filter((c) => !legacy.has(c.id));
      if (existing.length === 0) {
        const c = await this.createCampaign('Classic Cold War 1947');
        this.log.log(`Created default campaign "${c.name}"`);
      }
    } catch (err) {
      this.log.error(
        `Could not check or create the default campaign. Did you run "npm run db:push"? ${(err as Error).message}`,
      );
    }
  }

  async createCampaign(name: string) {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [campaign] = await tx.insert(campaigns).values({ name }).returning();

      const countryRows = await tx
        .insert(countries)
        .values(
          COUNTRIES.map((c) => ({
            campaignId: campaign.id,
            code: c.code,
            name: c.name,
            color: c.color,
            isPlayable: c.playable,
            aiControlled: true,
            ...addResources(STARTING_RESOURCES, c.startBonus ?? {}),
            resourcesUpdatedAt: now,
            aiNextDecisionAt: new Date(now.getTime() + 60_000),
          })),
        )
        .returning();
      const countryByCode = new Map(countryRows.map((r) => [r.code, r]));

      const provinceRows = await tx
        .insert(provinces)
        .values(
          PROVINCES.map((p) => ({
            campaignId: campaign.id,
            key: p.key,
            name: p.name,
            ownerCountryId: countryByCode.get(p.countryCode)!.id,
            terrain: p.terrain,
            isCoastal: p.isCoastal,
            buildingSlots: p.buildingSlots,
            defense: p.isCapital ? 20 : 10,
            population: p.population,
            production: p.production,
          })),
        )
        .returning();
      const provinceByKey = new Map(provinceRows.map((r) => [r.key, r]));

      // Capitals start with a factory, a recruitment center and a small garrison.
      const recruitMs = scaleSeconds(BUILDINGS.recruitment_center.recruitIntervalSeconds!, env.GAME_SPEED) * 1000;
      const buildingValues: (typeof buildings.$inferInsert)[] = [];
      const formationValues: (typeof formations.$inferInsert)[] = [];

      for (const geo of PROVINCES.filter((p) => p.isCapital)) {
        const country = countryByCode.get(geo.countryCode)!;
        const province = provinceByKey.get(geo.key)!;
        await tx.update(countries).set({ capitalProvinceId: province.id }).where(eq(countries.id, country.id));
        buildingValues.push(
          {
            campaignId: campaign.id,
            provinceId: province.id,
            type: 'local_factory',
            status: 'complete',
            startedAt: now,
            completesAt: now,
          },
          {
            campaignId: campaign.id,
            provinceId: province.id,
            type: 'recruitment_center',
            status: 'complete',
            startedAt: now,
            completesAt: now,
            nextActionAt: new Date(now.getTime() + recruitMs),
          },
        );
        formationValues.push({
          campaignId: campaign.id,
          countryId: country.id,
          provinceId: province.id,
          name: GARRISON_NAME,
        });
      }
      // Every other province gets a small garrison, so land has to be fought for.
      const garrisonSize = new Map<string, number>();
      for (const geo of PROVINCES) {
        const province = provinceByKey.get(geo.key)!;
        garrisonSize.set(province.id, geo.isCapital ? STARTING_GARRISON : STARTING_PROVINCE_GARRISON);
        if (!geo.isCapital) {
          formationValues.push({
            campaignId: campaign.id,
            countryId: countryByCode.get(geo.countryCode)!.id,
            provinceId: province.id,
            name: GARRISON_NAME,
          });
        }
      }
      await tx.insert(buildings).values(buildingValues);
      const formationRows = await tx.insert(formations).values(formationValues).returning();
      await tx.insert(formationUnits).values(
        formationRows.map((f) => ({ formationId: f.id, unitType: RECRUIT_UNIT, count: garrisonSize.get(f.provinceId)! })),
      );

      return campaign;
    });
  }

  async list(userId: string): Promise<CampaignSummary[]> {
    const legacy = await this.legacyCampaignIds();
    const rows = (await this.db.select().from(campaigns).orderBy(campaigns.createdAt)).filter((c) => !legacy.has(c.id));
    const ps = await this.db
      .select({ campaignId: players.campaignId, userId: players.userId, countryId: players.countryId })
      .from(players);
    return rows.map((c) => {
      const inCampaign = ps.filter((p) => p.campaignId === c.id);
      return {
        id: c.id,
        name: c.name,
        startYear: c.startYear,
        playerCount: inCampaign.length,
        myCountryId: inCampaign.find((p) => p.userId === userId)?.countryId ?? null,
      };
    });
  }

  async lobby(campaignId: string): Promise<LobbyCountry[]> {
    const [campaign] = await this.db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, campaignId));
    if (!campaign) throw new NotFoundException('Campaign not found');
    const countryRows = await this.db.select().from(countries).where(eq(countries.campaignId, campaignId));
    const claimed = new Set(
      (await this.db.select({ countryId: players.countryId }).from(players).where(eq(players.campaignId, campaignId))).map(
        (p) => p.countryId,
      ),
    );
    const provRows = await this.db
      .select({ owner: provinces.ownerCountryId })
      .from(provinces)
      .where(eq(provinces.campaignId, campaignId));
    return countryRows.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      color: c.color,
      isPlayable: c.isPlayable,
      claimed: claimed.has(c.id),
      provinceCount: provRows.filter((p) => p.owner === c.id).length,
      blurb: COUNTRY_BY_CODE[c.code]?.blurb ?? '',
    }));
  }

  async join(userId: string, campaignId: string, countryId: string) {
    try {
      await this.db.transaction(async (tx) => {
        const [country] = await tx
          .select()
          .from(countries)
          .where(and(eq(countries.id, countryId), eq(countries.campaignId, campaignId)))
          .for('update');
        if (!country) throw new NotFoundException('Country not found in this campaign');
        if (!country.isPlayable) throw new ConflictException('That country is AI-controlled only');

        const [mine] = await tx
          .select({ id: players.id })
          .from(players)
          .where(and(eq(players.userId, userId), eq(players.campaignId, campaignId)));
        if (mine) throw new ConflictException('You have already joined this campaign');
        const [taken] = await tx.select({ id: players.id }).from(players).where(eq(players.countryId, countryId));
        if (taken) throw new ConflictException('Another player already controls that country');

        await tx.insert(players).values({ userId, campaignId, countryId });
        await tx.update(countries).set({ aiControlled: false }).where(eq(countries.id, countryId));
        await tx.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('That country or campaign slot was just taken');
      throw err;
    }
    this.realtime.addUserToRooms(userId, campaignId, countryId);
    this.realtime.campaignUpdate(campaignId, { kind: 'join' });
    return { ok: true, countryId };
  }

  async getState(userId: string, campaignId: string): Promise<GameState> {
    const player = await this.players.require(userId, campaignId);
    const [campaign] = await this.db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    if (!campaign) throw new NotFoundException('Campaign not found');
    const [user] = await this.db.select({ username: users.username }).from(users).where(eq(users.id, userId));

    const countryRows = await this.db.select().from(countries).where(eq(countries.campaignId, campaignId));
    const provRows = await this.db.select().from(provinces).where(eq(provinces.campaignId, campaignId));
    const bldRows = await this.db.select().from(buildings).where(eq(buildings.campaignId, campaignId));
    const unitRows = await this.db
      .select({ provinceId: formations.provinceId, count: formationUnits.count })
      .from(formationUnits)
      .innerJoin(formations, eq(formations.id, formationUnits.formationId))
      // Armies on the move are drawn as markers, not counted in a province.
      .where(and(eq(formations.campaignId, campaignId), isNull(formations.moveArrivesAt)));

    const keyById = new Map(provRows.map((p) => [p.id, p.key]));
    const countByOwner = new Map<string, number>();
    for (const p of provRows) countByOwner.set(p.ownerCountryId, (countByOwner.get(p.ownerCountryId) ?? 0) + 1);

    const stateCountries: StateCountry[] = countryRows.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      color: c.color,
      isPlayable: c.isPlayable,
      aiControlled: c.aiControlled,
      provinceCount: countByOwner.get(c.id) ?? 0,
      capitalProvinceKey: c.capitalProvinceId ? (keyById.get(c.capitalProvinceId) ?? null) : null,
    }));

    const unitsByProvince = new Map<string, number>();
    for (const u of unitRows) unitsByProvince.set(u.provinceId, (unitsByProvince.get(u.provinceId) ?? 0) + u.count);
    const bldsByProvince = new Map<string, BuildingDto[]>();
    for (const b of bldRows) {
      const list = bldsByProvince.get(b.provinceId) ?? [];
      list.push(toBuildingDto(b));
      bldsByProvince.set(b.provinceId, list);
    }
    const stateProvinces: StateProvince[] = provRows.map((p) => ({
      id: p.id,
      key: p.key,
      ownerCountryId: p.ownerCountryId,
      buildings: bldsByProvince.get(p.id) ?? [],
      unitCount: unitsByProvince.get(p.id) ?? 0,
    }));

    const myFormations = await this.db
      .select()
      .from(formations)
      .where(and(eq(formations.campaignId, campaignId), eq(formations.countryId, player.countryId)));
    const myUnits = myFormations.length
      ? await this.db
          .select()
          .from(formationUnits)
          .where(
            inArray(
              formationUnits.formationId,
              myFormations.map((f) => f.id),
            ),
          )
      : [];
    const myFormationDtos = myFormations.map((f) =>
      toFormationDto(
        f,
        myUnits.filter((u) => u.formationId === f.id),
        keyById,
      ),
    );

    const leaders = await this.db
      .select({ f: generals.deployedFormationId, g: generals.generalId })
      .from(generals)
      .where(eq(generals.countryId, player.countryId));
    const generalOf = new Map(leaders.filter((l) => l.f).map((l) => [l.f as string, l.g]));
    for (const dto of myFormationDtos) dto.generalId = generalOf.get(dto.id) ?? null;

    const resources = await this.economy.getLive(player.countryId);

    return {
      campaign: { id: campaign.id, name: campaign.name, startYear: campaign.startYear, gameSpeed: env.GAME_SPEED },
      me: { countryId: player.countryId, username: user?.username ?? 'player' },
      countries: stateCountries,
      provinces: stateProvinces,
      formations: myFormationDtos,
      atWarWith: [...(await this.wars.enemiesOf(this.db, player.countryId))],
      capitalMove: (() => {
        const me = countryRows.find((c) => c.id === player.countryId);
        const key = me?.capitalMoveProvinceId ? keyById.get(me.capitalMoveProvinceId) : undefined;
        return key && me?.capitalMoveAt ? { provinceKey: key, completesAt: me.capitalMoveAt.toISOString() } : null;
      })(),
      research: toResearchDto(await loadResearch(this.db, player.countryId)),
      resources,
      serverTime: new Date().toISOString(),
    };
  }

  async getProvince(userId: string, campaignId: string, provinceId: string): Promise<ProvinceDetail> {
    const viewer = await this.players.require(userId, campaignId);
    const [province] = await this.db
      .select()
      .from(provinces)
      .where(and(eq(provinces.id, provinceId), eq(provinces.campaignId, campaignId)));
    if (!province) throw new NotFoundException('Province not found');

    const [owner] = await this.db
      .select({ name: countries.name, capitalProvinceId: countries.capitalProvinceId })
      .from(countries)
      .where(eq(countries.id, province.ownerCountryId));
    const blds = await this.db.select().from(buildings).where(eq(buildings.provinceId, province.id));
    const formationRows = await this.db
      .select()
      .from(formations)
      .where(and(eq(formations.provinceId, province.id), isNull(formations.moveArrivesAt)));
    const allProvinces = await this.db
      .select({ id: provinces.id, key: provinces.key })
      .from(provinces)
      .where(eq(provinces.campaignId, campaignId));
    const keyById = new Map(allProvinces.map((p) => [p.id, p.key]));
    const unitRows = formationRows.length
      ? await this.db
          .select()
          .from(formationUnits)
          .where(
            inArray(
              formationUnits.formationId,
              formationRows.map((f) => f.id),
            ),
          )
      : [];

    const formationDtos: FormationDto[] = formationRows.map((f) =>
      toFormationDto(
        f,
        unitRows.filter((u) => u.formationId === f.id),
        keyById,
      ),
    );

    return {
      id: province.id,
      key: province.key,
      name: province.name,
      terrain: province.terrain,
      isCoastal: province.isCoastal,
      isCapital: owner?.capitalProvinceId === province.id,
      buildingSlots: province.buildingSlots,
      defense: province.defense,
      population: province.population,
      production: province.production,
      ownerCountryId: province.ownerCountryId,
      ownerName: owner?.name ?? 'Unknown',
      buildings: blds.map(toBuildingDto),
      formations: formationDtos,
      disruptedUntil: province.disruptedUntil ? province.disruptedUntil.toISOString() : null,
      productionQueue: province.ownerCountryId === viewer.countryId ? await this.production.listForProvince(province.id) : [],
    };
  }
}
