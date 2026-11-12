import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { env } from './config/env';
import { timingMiddleware } from './common/perf';
import { gzipJson, securityHeaders } from './common/security';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);
  app.useBodyParser('json', { limit: '64kb' });
  app.use(timingMiddleware);
  app.use(securityHeaders);
  app.use(gzipJson);
  app.use(cookieParser());
  app.enableCors({
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  });
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  Logger.log(`Server listening on http://localhost:${env.PORT} (game speed x${env.GAME_SPEED})`, 'Bootstrap');
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
