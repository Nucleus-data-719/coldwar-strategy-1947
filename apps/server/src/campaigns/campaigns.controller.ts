import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { BUILDING_TYPES, UNIT_TYPES } from '@cw/shared';
import { AuthGuard } from '../auth/auth.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { parse } from '../common/zod';
import { env } from '../config/env';
import { BuildingsService } from '../buildings/buildings.service';
import { GeneralsService } from '../generals/generals.service';
import { DiplomacyService } from '../diplomacy/diplomacy.service';
import { ResearchService } from '../research/research.service';
import { CapitalService } from '../capital/capital.service';
import { FormationsService } from '../military/formations.service';
import { ProductionService } from '../production/production.service';
import { CombatService } from '../military/combat.service';
import { MovementService } from '../military/movement.service';
import { NavalService } from '../military/naval.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlayersService } from '../players/players.service';
import { WarsService } from '../wars/wars.service';
import { CampaignsService } from './campaigns.service';

const createSchema = z.object({ name: z.string().trim().min(3).max(60) });
const joinSchema = z.object({ countryId: z.string().uuid() });
const buildSchema = z.object({ type: z.enum(BUILDING_TYPES) });
const produceSchema = z.object({ unitType: z.enum(UNIT_TYPES), quantity: z.number().int().min(1).max(100) });
const mergeSchema = z.object({ intoId: z.string().uuid() });
const splitSchema = z.object({ units: z.record(z.enum(UNIT_TYPES), z.number().int().min(0).max(100000)) });
const capitalSchema = z.object({ provinceId: z.string().uuid() });
const researchSchema = z.object({ techId: z.string().min(1).max(40) });
const deploySchema = z.object({ formationId: z.string().uuid() });
const countrySchema = z.object({ countryId: z.string().uuid() });
const respondSchema = z.object({ countryId: z.string().uuid(), accept: z.boolean() });
const assistSchema = z.object({
  countryId: z.string().uuid(),
  gift: z
    .object({
      money: z.number().int().min(0).max(1_000_000).optional(),
      food: z.number().int().min(0).max(1_000_000).optional(),
      oil: z.number().int().min(0).max(1_000_000).optional(),
      steel: z.number().int().min(0).max(1_000_000).optional(),
      electronics: z.number().int().min(0).max(1_000_000).optional(),
      rare: z.number().int().min(0).max(1_000_000).optional(),
      wood: z.number().int().min(0).max(1_000_000).optional(),
    })
    .strict(),
});
const warSchema = z.object({ countryId: z.string().uuid() });
const sailSchema = z
  .object({
    provinceId: z.string().uuid().optional(),
    node: z.number().int().min(0).max(100000).optional(),
    units: z.record(z.enum(UNIT_TYPES), z.number().int().min(0).max(100000)).optional(),
  })
  .refine((v) => v.provinceId !== undefined || v.node !== undefined, 'Choose where to sail');
const navalAttackSchema = z.object({
  targetId: z.string().uuid(),
  units: z.record(z.enum(UNIT_TYPES), z.number().int().min(0).max(100000)).optional(),
});
const delaySchema = z.object({ hours: z.number().min(0).max(24) });
const moveSchema = z.object({
  provinceId: z.string().uuid(),
  // Add the province to the end of the route the army already has.
  waypoint: z.boolean().optional(),
  // Optional: send only some units, as a new task force.
  units: z.record(z.enum(UNIT_TYPES), z.number().int().min(0).max(100000)).optional(),
});

@Controller('campaigns')
@UseGuards(AuthGuard)
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly naval: NavalService,
    private readonly players: PlayersService,
    private readonly buildingsService: BuildingsService,
    private readonly notifications: NotificationsService,
    private readonly movement: MovementService,
    private readonly warsService: WarsService,
    private readonly combat: CombatService,
    private readonly production: ProductionService,
    private readonly formationsService: FormationsService,
    private readonly capital: CapitalService,
    private readonly researchService: ResearchService,
    private readonly generalsService: GeneralsService,
    private readonly diplomacy: DiplomacyService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.campaigns.list(user.id);
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    if (!env.ALLOW_CAMPAIGN_CREATION) throw new ForbiddenException('Creating campaigns is disabled');
    const { name } = parse(createSchema, body);
    const campaign = await this.campaigns.createCampaign(name);
    return { id: campaign.id, name: campaign.name };
  }

  @Get(':id/lobby')
  lobby(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.lobby(id);
  }

  @Post(':id/join')
  @HttpCode(200)
  join(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { countryId } = parse(joinSchema, body);
    return this.campaigns.join(user.id, id, countryId);
  }

  @Get(':id/state')
  state(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.getState(user.id, id);
  }

  @Get(':id/provinces/:provinceId')
  province(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('provinceId', ParseUUIDPipe) provinceId: string,
  ) {
    return this.campaigns.getProvince(user.id, id, provinceId);
  }

  @Post(':id/provinces/:provinceId/buildings')
  @HttpCode(200)
  build(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('provinceId', ParseUUIDPipe) provinceId: string,
    @Body() body: unknown,
  ) {
    const { type } = parse(buildSchema, body);
    return this.buildingsService.construct(user.id, id, provinceId, type);
  }

  @Post(':id/formations/:formationId/move')
  @HttpCode(200)
  move(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('formationId', ParseUUIDPipe) formationId: string,
    @Body() body: unknown,
  ) {
    const { provinceId, units, waypoint } = parse(moveSchema, body);
    return this.movement.order(user.id, id, formationId, provinceId, units, waypoint);
  }

  @Post(':id/formations/:formationId/delay')
  @HttpCode(200)
  delay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('formationId', ParseUUIDPipe) formationId: string,
    @Body() body: unknown,
  ) {
    const { hours } = parse(delaySchema, body);
    return this.movement.delay(user.id, id, formationId, hours);
  }

  @Post(':id/formations/:formationId/patrol')
  @HttpCode(200)
  patrol(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('formationId', ParseUUIDPipe) formationId: string,
    @Body() body: unknown,
  ) {
    const { provinceId, units } = parse(moveSchema, body);
    return this.movement.orderPatrol(user.id, id, formationId, provinceId, units);
  }

  @Post(':id/formations/:formationId/stop')
  @HttpCode(200)
  stop(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('formationId', ParseUUIDPipe) formationId: string,
  ) {
    return this.naval.stop(user.id, id, formationId);
  }

  @Post(':id/formations/:formationId/sail')
  @HttpCode(200)
  sail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('formationId', ParseUUIDPipe) formationId: string,
    @Body() body: unknown,
  ) {
    const { provinceId, node, units } = parse(sailSchema, body);
    return this.naval.sail(user.id, id, formationId, { toProvinceId: provinceId, toNode: node }, units);
  }

  @Post(':id/formations/:formationId/naval-attack')
  @HttpCode(200)
  navalAttack(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('formationId', ParseUUIDPipe) formationId: string,
    @Body() body: unknown,
  ) {
    const { targetId, units } = parse(navalAttackSchema, body);
    return this.naval.attack(user.id, id, formationId, targetId, units);
  }

  @Post(':id/formations/:formationId/lay-mines')
  @HttpCode(200)
  layMines(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('formationId', ParseUUIDPipe) formationId: string,
  ) {
    return this.naval.layMines(user.id, id, formationId);
  }

  @Post(':id/provinces/:provinceId/production')
  @HttpCode(200)
  produce(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('provinceId', ParseUUIDPipe) provinceId: string,
    @Body() body: unknown,
  ) {
    const { unitType, quantity } = parse(produceSchema, body);
    return this.production.enqueue(user.id, id, provinceId, unitType, quantity);
  }

  @Post(':id/production/:orderId/cancel')
  @HttpCode(200)
  cancelProduction(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.production.cancel(user.id, id, orderId);
  }

  @Post(':id/formations/:formationId/merge')
  @HttpCode(200)
  merge(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('formationId', ParseUUIDPipe) formationId: string,
    @Body() body: unknown,
  ) {
    const { intoId } = parse(mergeSchema, body);
    return this.formationsService.merge(user.id, id, formationId, intoId);
  }

  @Post(':id/formations/:formationId/split')
  @HttpCode(200)
  split(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('formationId', ParseUUIDPipe) formationId: string,
    @Body() body: unknown,
  ) {
    const { units } = parse(splitSchema, body);
    return this.formationsService.split(user.id, id, formationId, units);
  }

  @Post(':id/capital')
  @HttpCode(200)
  moveCapital(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { provinceId } = parse(capitalSchema, body);
    return this.capital.relocate(user.id, id, provinceId);
  }

  @Post(':id/research')
  @HttpCode(200)
  startResearch(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { techId } = parse(researchSchema, body);
    return this.researchService.start(user.id, id, techId);
  }

  @Post(':id/research/cancel')
  @HttpCode(200)
  cancelResearch(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.researchService.cancel(user.id, id);
  }

  @Get(':id/generals')
  listGenerals(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.generalsService.state(user.id, id);
  }

  @Post(':id/generals/dispatch')
  @HttpCode(200)
  claimDispatch(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.generalsService.dispatch(user.id, id);
  }

  @Post(':id/generals/:generalId/deploy')
  @HttpCode(200)
  deployGeneral(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('generalId') generalId: string,
    @Body() body: unknown,
  ) {
    const { formationId } = parse(deploySchema, body);
    return this.generalsService.deploy(user.id, id, generalId, formationId);
  }

  @Post(':id/generals/:generalId/undeploy')
  @HttpCode(200)
  undeployGeneral(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('generalId') generalId: string) {
    return this.generalsService.undeploy(user.id, id, generalId);
  }

  @Post(':id/generals/:generalId/activate')
  @HttpCode(200)
  activateGeneral(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('generalId') generalId: string) {
    return this.generalsService.activate(user.id, id, generalId);
  }

  @Get(':id/diplomacy')
  diplomacyState(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.diplomacy.state(user.id, id);
  }

  @Post(':id/diplomacy/alliance')
  @HttpCode(200)
  proposeAlliance(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.diplomacy.propose(user.id, id, parse(countrySchema, body).countryId);
  }

  @Post(':id/diplomacy/alliance/respond')
  @HttpCode(200)
  respondAlliance(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { countryId, accept } = parse(respondSchema, body);
    return this.diplomacy.respond(user.id, id, countryId, accept);
  }

  @Post(':id/diplomacy/alliance/break')
  @HttpCode(200)
  breakAlliance(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.diplomacy.breakAlliance(user.id, id, parse(countrySchema, body).countryId);
  }

  @Post(':id/diplomacy/calls/:callId/join')
  @HttpCode(200)
  joinCall(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('callId', ParseUUIDPipe) callId: string) {
    return this.diplomacy.joinNow(user.id, id, callId);
  }

  @Post(':id/diplomacy/calls/:callId/decline')
  @HttpCode(200)
  declineCall(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('callId', ParseUUIDPipe) callId: string) {
    return this.diplomacy.decline(user.id, id, callId);
  }

  @Post(':id/diplomacy/assist')
  @HttpCode(200)
  assist(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { countryId, gift } = parse(assistSchema, body);
    return this.diplomacy.assist(user.id, id, countryId, gift);
  }

  @Get(':id/wars')
  wars(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.warsService.list(user.id, id);
  }

  @Post(':id/wars')
  @HttpCode(200)
  declareWar(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { countryId } = parse(warSchema, body);
    return this.warsService.declare(user.id, id, countryId);
  }

  @Get(':id/battles')
  battles(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.combat.listReports(user.id, id);
  }

  @Get(':id/notifications')
  async notificationList(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const player = await this.players.require(user.id, id);
    return this.notifications.list(player.countryId);
  }

  @Post(':id/notifications/read')
  @HttpCode(200)
  async markRead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const player = await this.players.require(user.id, id);
    await this.notifications.markAllRead(player.countryId);
    return { ok: true };
  }
}
