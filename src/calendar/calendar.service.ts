import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/database/prisma.service';
import { GoogleCalendarService } from './google-calendar.service';

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly google: GoogleCalendarService,
  ) {}

  /** Builds the Google consent URL. State is a short-lived signed token binding the flow to this user. */
  getAuthUrl(userId: string): { url: string } {
    const state = this.jwt.sign(
      { sub: userId, purpose: 'gcal' },
      { secret: this.config.get<string>('jwt.secret'), expiresIn: '10m' },
    );
    return { url: this.google.getAuthUrl(state) };
  }

  /**
   * OAuth callback. Verifies state, exchanges the code, and stores the tokens.
   * Returns the frontend URL to redirect the browser to.
   */
  async handleCallback(code?: string, state?: string, error?: string): Promise<string> {
    const appUrl = this.config.get<string>('appUrl') ?? 'http://localhost:3000';
    const fail = `${appUrl}/dashboard?calendar=error`;

    if (error || !code || !state) return fail;

    let userId: string;
    try {
      const payload = this.jwt.verify<{ sub: string; purpose: string }>(state, {
        secret: this.config.get<string>('jwt.secret'),
      });
      if (payload.purpose !== 'gcal') return fail;
      userId = payload.sub;
    } catch {
      return fail;
    }

    try {
      const tokens = await this.google.exchangeCode(code);
      if (!tokens.refresh_token) {
        // Happens if the user previously granted access and Google withheld a new
        // refresh token. Ask them to remove access and retry with fresh consent.
        this.logger.warn(`[gcal] no refresh_token returned for ${userId}`);
        return `${appUrl}/dashboard?calendar=norefresh`;
      }
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          google_calendar_enabled: true,
          google_refresh_token: tokens.refresh_token,
          google_access_token: tokens.access_token ?? null,
          google_token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          google_calendar_id: 'primary',
        },
      });
      return `${appUrl}/dashboard?calendar=connected`;
    } catch (e: any) {
      this.logger.error(`[gcal] callback failed for ${userId}: ${e?.message}`);
      return fail;
    }
  }

  /** Disconnects Google Calendar: revokes the token best-effort and clears stored credentials. */
  async disconnect(userId: string): Promise<{ disconnected: true }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        google_calendar_enabled: false,
        google_refresh_token: null,
        google_access_token: null,
        google_token_expiry: null,
      },
    });
    return { disconnected: true };
  }

  async getStatus(userId: string): Promise<{ connected: boolean; calendarId: string | null }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { google_calendar_enabled: true, google_refresh_token: true, google_calendar_id: true },
    });
    return {
      connected: Boolean(user?.google_calendar_enabled && user?.google_refresh_token),
      calendarId: user?.google_calendar_id ?? null,
    };
  }

  /** Upcoming Google events for the dashboard calendar overlay. */
  async getEvents(userId: string, from?: string, to?: string) {
    const timeMin = from ? new Date(from) : new Date();
    const timeMax = to ? new Date(to) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    if (isNaN(timeMin.getTime()) || isNaN(timeMax.getTime())) {
      throw new BadRequestException('Invalid date range');
    }

    const items = await this.google.listEvents(userId, timeMin, timeMax);

    // Exclude events BookPro itself mirrored into Google for its own appointments, so each
    // appointment shows once (its coloured card on the calendar), not twice. Matched by id
    // against the DB — robust even if the doctor moved the event to another day.
    const eventIds = items.map((e) => e.id).filter((id): id is string => Boolean(id));
    const own = eventIds.length
      ? await this.prisma.appointments.findMany({
          where: { profile_id: userId, google_event_id: { in: eventIds } },
          select: { google_event_id: true },
        })
      : [];
    const ownEventIds = new Set(own.map((a) => a.google_event_id).filter(Boolean) as string[]);

    return items
      .filter((e) => !e.id || !ownEventIds.has(e.id))
      .map((e) => ({
      id: e.id,
      summary: e.summary ?? '(χωρίς τίτλο)',
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? e.end?.date ?? null,
      allDay: Boolean(e.start?.date),
      htmlLink: e.htmlLink ?? null,
    }));
  }
}
