import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

/** Thin wrapper around the Socket.IO server so game services can push updates. */
@Injectable()
export class RealtimeService {
  server?: Server;

  /** Tells every client in the campaign that something changed and they should refetch. */
  campaignUpdate(campaignId: string, payload: Record<string, unknown> = {}) {
    this.server?.to(`campaign:${campaignId}`).emit('campaign:update', payload);
  }

  toCountry(countryId: string, event: string, payload: unknown) {
    this.server?.to(`country:${countryId}`).emit(event, payload);
  }

  /** Puts all of a user's open sockets into the rooms of a campaign they just joined. */
  addUserToRooms(userId: string, campaignId: string, countryId: string) {
    this.server?.in(`user:${userId}`).socketsJoin([`campaign:${campaignId}`, `country:${countryId}`]);
  }
}
