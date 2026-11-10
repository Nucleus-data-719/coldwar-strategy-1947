import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { parse } from '../common/zod';
import { DB, Db } from '../db/db.module';
import { feedback } from '../db/schema';

const schema = z.object({
  campaignId: z.string().uuid().optional(),
  message: z.string().trim().min(3).max(2000),
  // Free-form details from the browser (screen, selected province, recent errors). Capped in size.
  context: z.record(z.unknown()).optional(),
});

/** Playtest feedback: players report confusing screens and bugs, stored for the developer to read. */
@Controller('feedback')
@UseGuards(AuthGuard)
export class FeedbackController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Post()
  @HttpCode(200)
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { campaignId, message, context } = parse(schema, body);
    const text = JSON.stringify(context ?? {});
    await this.db.insert(feedback).values({
      userId: user.id,
      campaignId,
      message,
      context: text.length > 8000 ? { truncated: true } : (context ?? {}),
    });
    return { ok: true };
  }
}
