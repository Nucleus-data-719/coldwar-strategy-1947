import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { env } from './config/env';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './common/health.controller';
import { DbModule } from './db/db.module';
import { GameModule } from './game.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: env.RATE_LIMIT_PER_MIN }]),
    DbModule,
    AuthModule,
    RealtimeModule,
    GameModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
