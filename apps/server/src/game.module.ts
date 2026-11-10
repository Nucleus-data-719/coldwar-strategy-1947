import { Module } from '@nestjs/common';
import { AiService } from './ai/ai.service';
import { AuthModule } from './auth/auth.module';
import { BuildingsService } from './buildings/buildings.service';
import { CampaignsController } from './campaigns/campaigns.controller';
import { CampaignsService } from './campaigns/campaigns.service';
import { EconomyService } from './economy/economy.service';
import { FeedbackController } from './feedback/feedback.controller';
import { GeneralsService } from './generals/generals.service';
import { ResearchService } from './research/research.service';
import { CapitalService } from './capital/capital.service';
import { FormationsService } from './military/formations.service';
import { ProductionService } from './production/production.service';
import { CombatService } from './military/combat.service';
import { MovementService } from './military/movement.service';
import { NotificationsService } from './notifications/notifications.service';
import { PlayersService } from './players/players.service';
import { SchedulerService } from './scheduler/scheduler.service';
import { WarsService } from './wars/wars.service';

@Module({
  imports: [AuthModule],
  controllers: [CampaignsController, FeedbackController],
  providers: [
    EconomyService,
    PlayersService,
    NotificationsService,
    BuildingsService,
    WarsService,
    CombatService,
    ProductionService,
    CapitalService,
    ResearchService,
    GeneralsService,
    MovementService,
    FormationsService,
    CampaignsService,
    AiService,
    SchedulerService,
  ],
})
export class GameModule {}
