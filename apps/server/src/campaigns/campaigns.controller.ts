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
import { CapitalService } from '../capital/capital.service';
import { FormationsService } from '../military/formations.service';
import { ProductionService } from '../production/production.service';
import { CombatService } from '../military/combat.service';
import { MovementService } from '../military/movement.service';
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
const warSchema = z.object({ countryId: z.string().uuid() });
const moveSchema = z.object({
  provinceId: z.string().uuid(),
  // Optional: send only some units, as a new task force.
  units: z.record(z.enum(UNIT_TYPES), z.number().int().min(0).max(100000)).optional(),
});

@Controller('campaigns')
@UseGuards(AuthGuard)
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly players: PlayersService,
    private readonly buildingsService: BuildingsService,
    private readonly notifications: NotificationsService,
    private readonly movement: MovementService,
    private readonly warsService: WarsService,
    private readonly combat: CombatService,
    private readonly production: ProductionService,
    private readonly formationsService: FormationsService,
    private readonly capital: CapitalService,
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
    const { provinceId, units } = parse(moveSchema, body);
    return this.movement.order(user.id, id, formationId, provinceId, units);
  }

  @Post(':id/formations/:formationId/stop')
  @HttpCode(200)
  stop(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('formationId', ParseUUIDPipe) formationId: string,
  ) {
    return this.movement.stop(user.id, id, formationId);
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
