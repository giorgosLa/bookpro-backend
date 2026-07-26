import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '@/database/prisma.service';

export interface BusyInterval {
  start: Date;
  end: Date;
  /**
   * The Google event id this interval came from (present when derived via events.list).
   * Lets callers drop events BookPro itself created — matched against a stored
   * `google_event_id` — so an appointment is never blocked twice.
   */
  eventId?: string;
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  /** UTC instant. */
  start: Date;
  /** UTC instant. */
  end: Date;
  /** IANA timezone the event should display in, e.g. "Europe/Athens". */
  timeZone: string;
  location?: string;
}

/**
 * Low-level wrapper around the Google Calendar API for a single doctor's calendar.
 *
 * Every public method is best-effort: it swallows and reports errors instead of
 * throwing, so a Google outage can never break the core booking flow (direction
 * BookPro→Google) nor hide all availability (direction Google→BookPro fails open
 * to an empty busy list). Token refresh is handled by google-auth-library, and we
 * persist the refreshed access token via the client's 'tokens' event.
 */
@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  // calendar.events → create/update/delete the events WE own.
  // calendar.readonly → freebusy + listing the doctor's other events.
  static readonly SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private baseClient(): OAuth2Client {
    return new google.auth.OAuth2(
      this.config.get<string>('google.clientId'),
      this.config.get<string>('google.clientSecret'),
      this.config.get<string>('google.redirectUri'),
    );
  }

  /** Consent URL — offline access + forced consent so we always receive a refresh token. */
  getAuthUrl(state: string): string {
    return this.baseClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GoogleCalendarService.SCOPES,
      state,
      include_granted_scopes: true,
    });
  }

  /** Exchanges an OAuth code for tokens (called from the callback). */
  async exchangeCode(code: string) {
    const { tokens } = await this.baseClient().getToken(code);
    return tokens; // { refresh_token?, access_token?, expiry_date?, scope, token_type }
  }

  /**
   * Builds an authenticated client for a connected doctor, or null if they have
   * not connected Google Calendar. Persists any silently-refreshed access token.
   */
  private async authedClient(
    userId: string,
  ): Promise<{ client: OAuth2Client; calendarId: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        google_calendar_enabled: true,
        google_refresh_token: true,
        google_access_token: true,
        google_token_expiry: true,
        google_calendar_id: true,
      },
    });
    if (!user?.google_calendar_enabled || !user.google_refresh_token) return null;

    const client = this.baseClient();
    client.setCredentials({
      refresh_token: user.google_refresh_token,
      access_token: user.google_access_token ?? undefined,
      expiry_date: user.google_token_expiry?.getTime() ?? undefined,
    });

    // Persist tokens the library refreshes under the hood.
    client.on('tokens', (tokens) => {
      this.prisma.user
        .update({
          where: { id: userId },
          data: {
            ...(tokens.access_token ? { google_access_token: tokens.access_token } : {}),
            ...(tokens.expiry_date ? { google_token_expiry: new Date(tokens.expiry_date) } : {}),
            ...(tokens.refresh_token ? { google_refresh_token: tokens.refresh_token } : {}),
          },
        })
        .catch((e) => this.logger.warn(`[tokens] persist failed for ${userId}: ${e?.message}`));
    });

    return { client, calendarId: user.google_calendar_id ?? 'primary' };
  }

  private api(client: OAuth2Client): calendar_v3.Calendar {
    return google.calendar({ version: 'v3', auth: client });
  }

  /** Creates an event; returns the Google event id, or null on failure/not-connected. */
  async createEvent(userId: string, input: CalendarEventInput): Promise<string | null> {
    const authed = await this.authedClient(userId);
    if (!authed) return null;
    try {
      const res = await this.api(authed.client).events.insert({
        calendarId: authed.calendarId,
        requestBody: {
          summary: input.summary,
          description: input.description,
          location: input.location,
          start: { dateTime: input.start.toISOString(), timeZone: input.timeZone },
          end: { dateTime: input.end.toISOString(), timeZone: input.timeZone },
        },
      });
      return res.data.id ?? null;
    } catch (err) {
      this.report('createEvent', userId, err);
      return null;
    }
  }

  /** Updates an existing event's times/summary. No-op if not connected. */
  async updateEvent(
    userId: string,
    eventId: string,
    input: CalendarEventInput,
  ): Promise<boolean> {
    const authed = await this.authedClient(userId);
    if (!authed) return false;
    try {
      await this.api(authed.client).events.patch({
        calendarId: authed.calendarId,
        eventId,
        requestBody: {
          summary: input.summary,
          description: input.description,
          location: input.location,
          start: { dateTime: input.start.toISOString(), timeZone: input.timeZone },
          end: { dateTime: input.end.toISOString(), timeZone: input.timeZone },
        },
      });
      return true;
    } catch (err) {
      this.report('updateEvent', userId, err);
      return false;
    }
  }

  /** Deletes an event. Treats an already-deleted event (404/410) as success. */
  async deleteEvent(userId: string, eventId: string): Promise<boolean> {
    const authed = await this.authedClient(userId);
    if (!authed) return false;
    try {
      await this.api(authed.client).events.delete({
        calendarId: authed.calendarId,
        eventId,
      });
      return true;
    } catch (err: any) {
      const code = err?.code ?? err?.response?.status;
      if (code === 404 || code === 410) return true; // already gone
      this.report('deleteEvent', userId, err);
      return false;
    }
  }

  /**
   * Returns the doctor's busy intervals in [timeMin, timeMax] from their Google
   * calendar. Uses events.list (not the FreeBusy API) specifically so each interval
   * carries its `eventId` — the caller drops events BookPro itself created, otherwise
   * an appointment would be blocked both by its own DB row and by its mirror Google
   * event (and moving that event in Google would block a second, phantom slot).
   *
   * Skips cancelled events and those marked "Free" (transparency=transparent), matching
   * FreeBusy semantics. Fails OPEN (empty array) so a Google problem never hides slots.
   */
  async busyIntervals(userId: string, timeMin: Date, timeMax: Date): Promise<BusyInterval[]> {
    const authed = await this.authedClient(userId);
    if (!authed) return [];
    try {
      const res = await this.api(authed.client).events.list({
        calendarId: authed.calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
      });
      const out: BusyInterval[] = [];
      for (const e of res.data.items ?? []) {
        if (e.status === 'cancelled') continue;
        if (e.transparency === 'transparent') continue; // marked "Free" — doesn't block
        if (e.start?.dateTime && e.end?.dateTime) {
          out.push({
            start: new Date(e.start.dateTime),
            end: new Date(e.end.dateTime),
            eventId: e.id ?? undefined,
          });
        } else if (e.start?.date && e.end?.date) {
          // All-day event → busy for its whole span (as FreeBusy would report it).
          out.push({
            start: new Date(`${e.start.date}T00:00:00Z`),
            end: new Date(`${e.end.date}T00:00:00Z`),
            eventId: e.id ?? undefined,
          });
        }
      }
      return out;
    } catch (err) {
      this.report('busyIntervals', userId, err);
      return [];
    }
  }

  /** Lists the doctor's events in a window (for the dashboard calendar overlay). */
  async listEvents(userId: string, timeMin: Date, timeMax: Date) {
    const authed = await this.authedClient(userId);
    if (!authed) return [];
    try {
      const res = await this.api(authed.client).events.list({
        calendarId: authed.calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
      });
      return res.data.items ?? [];
    } catch (err) {
      this.report('listEvents', userId, err);
      return [];
    }
  }

  private report(op: string, userId: string, err: unknown) {
    this.logger.warn(`[google-calendar:${op}] ${userId}: ${(err as Error)?.message}`);
    Sentry.captureException(err, { tags: { area: 'google-calendar', op }, extra: { userId } });
  }
}
