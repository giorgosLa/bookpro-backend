import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { CalendarSyncService } from '@/calendar/calendar-sync.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private prisma: PrismaService,
    private calendarSync: CalendarSyncService,
  ) {}

  async handleGoogleCalendarPush(headers: Record<string, string>) {
    const channelId = headers['x-goog-channel-id'];
    const resourceId = headers['x-goog-resource-id'];
    const state = headers['x-goog-resource-state'];

    if (!channelId || state === 'sync') return;

    const tokens = await this.prisma.google_tokens.findFirst({
      where: { webhook_channel_id: channelId, webhook_resource_id: resourceId },
    });

    if (!tokens) {
      this.logger.warn(`Unknown webhook channel: ${channelId}`);
      return;
    }

    try {
      await this.calendarSync.syncCalendarChanges(tokens.user_id);
    } catch (err) {
      this.logger.error(`Calendar sync failed for user ${tokens.user_id}`, (err as Error).stack);
    }
  }
}
