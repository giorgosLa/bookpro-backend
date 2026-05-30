import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { google } from 'googleapis';
import { PrismaService } from '@/database/prisma.service';
import { CalendarSyncService } from './calendar-sync.service';

@Injectable()
export class CalendarService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private calendarSync: CalendarSyncService,
  ) {}

  getAuthUrl() {
    const oauth2 = new google.auth.OAuth2(
      this.config.get('google.clientId'),
      this.config.get('google.clientSecret'),
      this.config.get('google.redirectUri'),
    );
    return oauth2.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar'],
      prompt: 'consent',
    });
  }

  async handleCallback(code: string, userId: string) {
    const oauth2 = new google.auth.OAuth2(
      this.config.get('google.clientId'),
      this.config.get('google.clientSecret'),
      this.config.get('google.redirectUri'),
    );

    const { tokens } = await oauth2.getToken(code);

    const existing = await this.prisma.google_tokens.findUnique({ where: { user_id: userId } });

    if (existing) {
      await this.prisma.google_tokens.update({
        where: { user_id: userId },
        data: {
          access_token: tokens.access_token!,
          refresh_token: tokens.refresh_token ?? existing.refresh_token,
          expires_at: new Date(tokens.expiry_date!),
          updated_at: new Date(),
        },
      });
    } else {
      await this.prisma.google_tokens.create({
        data: {
          id: (await import('uuid')).v4(),
          user_id: userId,
          access_token: tokens.access_token!,
          refresh_token: tokens.refresh_token ?? null,
          expires_at: new Date(tokens.expiry_date!),
        },
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { google_calendar_enabled: true },
    });

    await this.calendarSync.setupWebhook(userId);

    return { message: 'Google Calendar connected' };
  }

  async disconnect(userId: string) {
    const tokens = await this.prisma.google_tokens.findUnique({ where: { user_id: userId } });
    if (tokens) {
      try {
        const oauth2 = new google.auth.OAuth2(
          this.config.get('google.clientId'),
          this.config.get('google.clientSecret'),
        );
        oauth2.setCredentials({ access_token: tokens.access_token });
        await oauth2.revokeCredentials();
      } catch {
        // token may already be expired — proceed with DB cleanup
      }
      await this.prisma.google_tokens.delete({ where: { user_id: userId } });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { google_calendar_enabled: false },
    });

    return { message: 'Google Calendar disconnected' };
  }

  async getEvents(userId: string) {
    const calendar = await this.calendarSync.getClient(userId);
    if (!calendar) return [];

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 20,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return res.data.items ?? [];
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async renewWebhooks() {
    const users = await this.prisma.user.findMany({
      where: { google_calendar_enabled: true },
      select: { id: true },
    });

    for (const user of users) {
      await this.calendarSync.setupWebhook(user.id);
    }
  }
}
