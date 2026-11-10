import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { NotificationDto } from '@cw/shared';
import { DB, Db, DbOrTx } from '../db/db.module';
import { notifications, NotificationRow } from '../db/schema';
import { RealtimeService } from '../realtime/realtime.service';

export function toNotificationDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly realtime: RealtimeService,
  ) {}

  /** Stores a notification. Call `publish` with the result after the transaction commits. */
  async add(
    tx: DbOrTx,
    n: { campaignId: string; countryId: string; type: string; message: string },
  ): Promise<NotificationRow> {
    const [row] = await tx.insert(notifications).values(n).returning();
    return row;
  }

  publish(row: NotificationRow) {
    this.realtime.toCountry(row.countryId, 'notification', toNotificationDto(row));
  }

  async list(countryId: string): Promise<NotificationDto[]> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.countryId, countryId))
      .orderBy(desc(notifications.createdAt))
      .limit(40);
    return rows.map(toNotificationDto);
  }

  async markAllRead(countryId: string) {
    await this.db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.countryId, countryId), eq(notifications.read, false)));
  }
}
