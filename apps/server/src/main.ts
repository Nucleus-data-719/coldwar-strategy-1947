import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { env } from './config/env';
import { timingMiddleware } from './common/perf';
import { gzipJson, securityHeaders } from './common/security';
import { siteGate } from './common/gate';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);
  app.useBodyParser('json', { limit: '64kb' });
  app.use(timingMiddleware);
  app.use(securityHeaders);
  app.use(gzipJson);
  app.use(compression());
  app.use(cookieParser());
  app.use(siteGate());
  app.use('/robots.txt', (_req: Request, res: Response) => res.type('text/plain').send(env.NOINDEX ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n'));

  // One service serves the game and its API, so the browser sees a single address (no cross-site cookies, no CORS).
  const webDist = env.WEB_DIST ? resolve(env.WEB_DIST) : resolve(__dirname, '../../web/dist');
  if (existsSync(resolve(webDist, 'index.html'))) {
    app.useStaticAssets(webDist, {
      index: false,
      setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(resolve(webDist, 'index.html'));
    });
    Logger.log(`Serving the web app from ${webDist}`, 'Bootstrap');
  }
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
