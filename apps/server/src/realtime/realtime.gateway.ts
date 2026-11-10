import { Inject } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { eq } from 'drizzle-orm';
import type { Server, Socket } from 'socket.io';
import { ActivityService } from '../auth/activity.service';
import { COOKIE_NAME, TokenService } from '../auth/token.service';
import { env } from '../config/env';
import { DB, Db } from '../db/db.module';
import { players } from '../db/schema';
import { RealtimeService } from './realtime.service';

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

@WebSocketGateway({
  cors: { origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()), credentials: true },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly tokens: TokenService,
    private readonly activity: ActivityService,
    @Inject(DB) private readonly db: Db,
  ) {}

  afterInit(server: Server) {
    this.realtime.server = server;
  }

  async handleConnection(client: Socket) {
    const token = readCookie(client.handshake.headers.cookie, COOKIE_NAME);
    const payload = token ? this.tokens.verify(token) : null;
    if (!payload) {
      client.disconnect(true);
      return;
    }
    const rows = await this.db
      .select({ campaignId: players.campaignId, countryId: players.countryId })
      .from(players)
      .where(eq(players.userId, payload.sub));
    await client.join([
      `user:${payload.sub}`,
      ...rows.flatMap((r) => [`campaign:${r.campaignId}`, `country:${r.countryId}`]),
    ]);
    void this.activity.touch(payload.sub);
  }
}
