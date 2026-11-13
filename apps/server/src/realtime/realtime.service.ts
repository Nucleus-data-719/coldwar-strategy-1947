import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

/** Thin wrapper around the Socket.IO server so game services can push updates. */
@Injectable()
export class RealtimeService {
  server?: Server;
  private listeners: ((campaignId: string, payload: Record<string, unknown>) => void)[] = [];

  /** Lets a service (the world cache) hear about every change. */
  onUpdate(cb: (campaignId: string, payload: Record<string, unknown>) => void) {
    this.listeners.push(cb);
  }

  /** True while at least one browser is connected. The game clock slows down when nobody is. */
  hasClients(): boolean {
    return (this.server?.engine?.clientsCount ?? 0) > 0;
  }

  /** Tells every client in the campaign that something changed and they should refetch. */
  campaignUpdate(campaignId: string, payload: Record<string, unknown> = {}) {
    for (const cb of this.listeners) cb(campaignId, payload);
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
