import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async getClient(userId: string) {
    const tokens = await this.prisma.google_tokens.findUnique({ where: { user_id: userId } });
    if (!tokens) return null;

    const oauth2 = new google.auth.OAuth2(
      this.config.get('google.clientId'),
      this.config.get('google.clientSecret'),
      this.config.get('google.redirectUri'),
    );

    oauth2.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? undefined,
      expiry_date: tokens.expires_at.getTime(),
    });

    oauth2.on('tokens', async (newTokens) => {
      await this.prisma.google_tokens.update({
        where: { user_id: userId },
        data: {
          access_token: newTokens.access_token ?? tokens.access_token,
          expires_at: newTokens.expiry_date ? new Date(newTokens.expiry_date) : tokens.expires_at,
          updated_at: new Date(),
        },
      });
    });

    return google.calendar({ version: 'v3', auth: oauth2 });
  }

  async syncAppointment(userId: string, appt: any) {
    const calendar = await this.getClient(userId);
    if (!calendar) return;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const timezone = user?.timezone ?? 'UTC';

    const eventBody = {
      summary: `${appt.services?.name ?? 'Appointment'} – ${appt.client_name}`,
      description: appt.notes ?? '',
      start: { dateTime: appt.start_time.toISOString(), timeZone: timezone },
      end: { dateTime: appt.end_time.toISOString(), timeZone: timezone },
    };

    try {
      if (appt.status === 'cancelled') {
        if (appt.google_event_id) {
          await calendar.events.delete({ calendarId: 'primary', eventId: appt.google_event_id });
          await this.prisma.appointments.update({
            where: { id: appt.id },
            data: { google_event_id: null },
          });
        }
        return;
      }

      if (appt.google_event_id) {
        await calendar.events.update({
          calendarId: 'primary',
          eventId: appt.google_event_id,
          requestBody: eventBody,
        });
      } else {
        const result = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: eventBody,
        });
        await this.prisma.appointments.update({
          where: { id: appt.id },
          data: { google_event_id: result.data.id },
        });
      }
    } catch (err) {
      this.logger.warn(`Failed to sync appointment ${appt.id}: ${(err as Error).message}`);
    }
  }

  async syncCalendarChanges(userId: string) {
    const calendar = await this.getClient(userId);
    if (!calendar) return;

    const tokens = await this.prisma.google_tokens.findUnique({ where: { user_id: userId } });
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { services: { where: { is_active: true }, take: 1 } },
    });
    if (!user) return;

    try {
      const res = await calendar.events.list({
        calendarId: 'primary',
        syncToken: tokens?.next_sync_token ?? undefined,
        maxResults: 100,
      });

      const items = res.data.items ?? [];
      for (const event of items) {
        if (event.status === 'cancelled') {
          await this.prisma.appointments.updateMany({
            where: { google_event_id: event.id!, profile_id: userId },
            data: { status: 'cancelled', updated_at: new Date() },
          });
        }
      }

      if (res.data.nextSyncToken) {
        await this.prisma.google_tokens.update({
          where: { user_id: userId },
          data: { next_sync_token: res.data.nextSyncToken },
        });
      }
    } catch (err: any) {
      if (err.code === 410) {
        await this.prisma.google_tokens.update({
          where: { user_id: userId },
          data: { next_sync_token: null },
        });
      } else {
        this.logger.warn(`Calendar sync failed for ${userId}: ${err.message}`);
      }
    }
  }

  async setupWebhook(userId: string) {
    const calendar = await this.getClient(userId);
    if (!calendar) return;

    const channelId = uuidv4();
    const apiUrl = this.config.get<string>('apiUrl') ?? 'http://localhost:4000';

    try {
      const res = await calendar.events.watch({
        calendarId: 'primary',
        requestBody: {
          id: channelId,
          type: 'web_hook',
          address: `${apiUrl}/api/v1/webhooks/google-calendar`,
          expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      await this.prisma.google_tokens.update({
        where: { user_id: userId },
        data: {
          webhook_channel_id: res.data.id,
          webhook_resource_id: res.data.resourceId,
        },
      });
    } catch (err) {
      this.logger.warn(`Webhook setup failed for ${userId}: ${(err as Error).message}`);
    }
  }
}
