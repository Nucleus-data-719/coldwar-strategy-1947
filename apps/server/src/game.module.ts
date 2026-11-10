import { Module } from '@nestjs/common';
import { AiService } from './ai/ai.service';
import { AuthModule } from './auth/auth.module';
import { BuildingsService } from './buildings/buildings.service';
import { CampaignsController } from './campaigns/campaigns.controller';
import { CampaignsService } from './campaigns/campaigns.service';
import { EconomyService } from './economy/economy.service';
import { CombatService } from './military/combat.service';
import { MovementService } from './military/movement.service';
import { NotificationsService } from './notifications/notifications.service';
import { PlayersService } from './players/players.service';
import { SchedulerService } from './scheduler/scheduler.service';
import { WarsService } from './wars/wars.service';

@Module({
  imports: [AuthModule],
  controllers: [CampaignsController],
  providers: [
    EconomyService,
    PlayersService,
    NotificationsService,
    BuildingsService,
    WarsService,
    CombatService,
    MovementService,
    CampaignsService,
    AiService,
    SchedulerService,
  ],
})
export class GameModule {}
