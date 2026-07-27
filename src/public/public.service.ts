import { Injectable, NotFoundException, ConflictException, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Sentry from "@sentry/nestjs";
import { MedicalSpecialty } from "@prisma/client";
import { PrismaService } from "@/database/prisma.service";
import { EmailService } from "@/email/email.service";
import { EventsService } from "@/events/events.service";
import { GoogleCalendarService } from "@/calendar/google-calendar.service";
import { CreateBookingDto } from "./dto/create-booking.dto";
import { RescheduleBookingDto } from "./dto/reschedule-booking.dto";
import { availCache, AVAIL_TTL, doctorsCache, DOCTORS_TTL, profileCache, PROFILE_TTL, gcalBusyCache, GCAL_BUSY_TTL } from "./cache";
import { addMinutes, addDays, format, startOfDay, endOfDay, addHours, subHours } from "date-fns";
import { v4 as uuidv4 } from "uuid";
import {
  CLINIC_DEFAULT_TZ,
  resolveTimezone,
  wallClockToUtc,
  todayStrInTz,
  dateStrInTz,
  dayOfWeekInTz,
} from "@/common/time/tz.util";
import { computeDaySlots, timeOfDay, dateOnly, fitsInAnyWindow } from "./slots.helper";
import { randomBytes } from "crypto";

function generateRefCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(6), (b) => chars[b % chars.length]).join("");
}

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private config: ConfigService,
    private events: EventsService,
    private googleCalendar: GoogleCalendarService,
  ) {}

  /** Builds the Google Calendar event payload for an appointment (direction BookPro→Google). */
  private buildEventInput(params: {
    clientName: string;
    serviceNames: string;
    refNumber: string;
    clientPhone?: string | null;
    notes?: string | null;
    locationName?: string | null;
    locationAddress?: string | null;
    start: Date;
    end: Date;
    timeZone: string;
  }) {
    const descLines = [
      `Υπηρεσία: ${params.serviceNames}`,
      `Πελάτης: ${params.clientName}`,
      params.clientPhone ? `Τηλέφωνο: ${params.clientPhone}` : null,
      `Κωδικός: ${params.refNumber}`,
      params.notes ? `Σημειώσεις: ${params.notes}` : null,
      '',
      'Κλείστηκε μέσω BookPro',
    ].filter(Boolean);
    return {
      summary: `${params.serviceNames} — ${params.clientName}`,
      description: descLines.join('\n'),
      start: params.start,
      end: params.end,
      timeZone: params.timeZone,
      location: params.locationName
        ? [params.locationName, params.locationAddress].filter(Boolean).join(', ')
        : params.locationAddress ?? undefined,
    };
  }

  /**
   * Google Calendar busy intervals for a doctor within [windowStart, windowEnd],
   * shaped as pseudo-appointments so they slot straight into computeDaySlots'
   * `appointments` list (direction Google→BookPro). On-demand FreeBusy query with a
   * short in-memory cache; fails open to [] so a Google problem never hides slots.
   *
   * Pass `enabled=false` (known from an already-loaded profile) to skip entirely and
   * avoid any work for the common not-connected case.
   */
  private async fetchGoogleBusy(
    profileId: string,
    windowStart: Date,
    windowEnd: Date,
    enabled?: boolean,
  ): Promise<{ start_time: Date; end_time: Date }[]> {
    if (enabled === false) return [];

    const key = `${profileId}:${windowStart.getTime()}:${windowEnd.getTime()}`;
    const now = Date.now();
    const cached = gcalBusyCache.get(key);
    let data = cached && cached.expiresAt > now ? cached.data : undefined;
    if (!data) {
      const busy = await this.googleCalendar.busyIntervals(profileId, windowStart, windowEnd);
      data = busy.map((b) => ({ start: b.start.getTime(), end: b.end.getTime(), eventId: b.eventId }));
      gcalBusyCache.set(key, { data, expiresAt: now + GCAL_BUSY_TTL });
    }

    // Drop events BookPro itself mirrored into Google for its own appointments (matched by
    // stored google_event_id). Otherwise an appointment blocks its slot twice — once via its
    // DB row, once via its Google event — and a doctor moving that event in Google would knock
    // out a second, phantom slot. Matched against the DB by id, so it's robust even when the
    // event was moved to a different day than the appointment's stored time.
    const own = await this.ownGoogleEventIds(profileId, data);
    return data
      .filter((b) => !b.eventId || !own.has(b.eventId))
      .map((b) => ({ start_time: new Date(b.start), end_time: new Date(b.end) }));
  }

  /** Of the given Google busy blocks, the set of event ids that mirror this doctor's BookPro appointments. */
  private async ownGoogleEventIds(
    profileId: string,
    busy: { eventId?: string }[],
  ): Promise<Set<string>> {
    const eventIds = busy.map((b) => b.eventId).filter((id): id is string => Boolean(id));
    if (eventIds.length === 0) return new Set();
    const mine = await this.prisma.appointments.findMany({
      where: { profile_id: profileId, google_event_id: { in: eventIds } },
      select: { google_event_id: true },
    });
    return new Set(mine.map((m) => m.google_event_id).filter((id): id is string => Boolean(id)));
  }

  /**
   * Authoritative guard: rejects a booking/reschedule that overlaps a Google Calendar
   * busy block. The slot UI already hides these, but a direct API call could target one,
   * so the write path must re-check. Fails open (allows the booking) if Google errors.
   * (fetchGoogleBusy already excludes the doctor's own mirror events, so a reschedule is
   * never rejected against its own Google copy.)
   */
  private async validateNotGoogleBusy(profileId: string, start: Date, end: Date, enabled?: boolean) {
    if (enabled === false) return;
    const busy = await this.fetchGoogleBusy(profileId, subHours(start, 1), addHours(end, 1), enabled);
    const clash = busy.some(
      (b) => b.start_time.getTime() < end.getTime() && b.end_time.getTime() > start.getTime(),
    );
    if (clash) throw new ConflictException("This time slot is no longer available");
  }

  private static readonly SPECIALTY_LABELS: Record<string, string> = {
    GENERAL_PRACTITIONER: "Παθολόγος",
    CARDIOLOGIST: "Καρδιολόγος",
    DERMATOLOGIST: "Δερματολόγος",
    ENDOCRINOLOGIST: "Ενδοκρινολόγος",
    GASTROENTEROLOGIST: "Γαστρεντερολόγος",
    NEUROLOGIST: "Νευρολόγος",
    OBSTETRICIAN_GYNECOLOGIST: "Γυναικολόγος",
    OPHTHALMOLOGIST: "Οφθαλμίατρος",
    ORTHOPEDIC_SURGEON: "Ορθοπεδικός",
    OTOLARYNGOLOGIST: "Ωτορινολαρυγγολόγος",
    PEDIATRICIAN: "Παιδίατρος",
    PSYCHIATRIST: "Ψυχίατρος",
    PULMONOLOGIST: "Πνευμονολόγος",
    RADIOLOGIST: "Ακτινολόγος",
    RHEUMATOLOGIST: "Ρευματολόγος",
    SURGEON: "Χειρουργός",
    UROLOGIST: "Ουρολόγος",
    DENTIST: "Οδοντίατρος",
    ORTHODONTIST: "Ορθοδοντικός",
    PHYSIOTHERAPIST: "Φυσιοθεραπευτής",
    PSYCHOLOGIST: "Ψυχολόγος",
    NUTRITIONIST: "Διαιτολόγος",
    OTHER: "Άλλο",
  };

  async search(q: string) {
    if (!q || q.trim().length < 2) return { specialties: [], doctors: [] };
    const term = q.trim().toLowerCase();

    const specialties = Object.entries(PublicService.SPECIALTY_LABELS)
      .filter(([, label]) => label.toLowerCase().includes(term))
      .slice(0, 4)
      .map(([key, label]) => ({ key, label }));

    const doctors = await this.prisma.user.findMany({
      where: {
        role: "DOCTOR",
        booking_url_slug: { not: null },
        is_suspended: false,
        doctor_profile: { verification_status: "APPROVED" },
        OR: [
          { full_name: { contains: q.trim(), mode: "insensitive" } },
          { business_name: { contains: q.trim(), mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        full_name: true,
        business_name: true,
        avatar_url: true,
        booking_url_slug: true,
        doctor_profile: { select: { specialty: true } },
      },
      take: 5,
    });

    return {
      specialties,
      doctors: doctors.map((d) => ({
        id: d.id,
        name: d.business_name ?? d.full_name ?? "",
        slug: d.booking_url_slug,
        avatar: d.avatar_url,
        specialty: d.doctor_profile?.specialty
          ? (PublicService.SPECIALTY_LABELS[d.doctor_profile.specialty] ?? "")
          : "",
      })),
    };
  }

  /** Returns all registered doctors who have a booking slug. Optionally filters by specialty enum. */
  async getDoctors(specialty?: string, location?: string) {
    const cacheKey = `${specialty?.trim() || "all"}:${location?.trim().toLowerCase() || "all"}`;
    const cached = doctorsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data as Awaited<ReturnType<typeof this.runDoctorsQuery>>;

    const validSpecialty =
      specialty && Object.values(MedicalSpecialty).includes(specialty as MedicalSpecialty)
        ? (specialty as MedicalSpecialty)
        : undefined;

    // Accent-insensitive location filter via unaccent extension
    let locationIds: string[] | undefined;
    if (location?.trim()) {
      const term = `%${location.trim()}%`;
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT u.id
        FROM profiles u
        LEFT JOIN locations l ON l.profile_id = u.id AND l.is_active = true
        WHERE
          unaccent(u.address) ILIKE unaccent(${term})
          OR unaccent(l.address) ILIKE unaccent(${term})
      `;
      locationIds = rows.map((r) => r.id);
      if (locationIds.length === 0) return [];
    }

    const doctors = await this.runDoctorsQuery(validSpecialty, locationIds);
    doctorsCache.set(cacheKey, { data: doctors, expiresAt: Date.now() + DOCTORS_TTL });
    return doctors;
  }

  /** The actual DB fetch for getDoctors — kept separate so the cache type can be inferred from it. */
  private runDoctorsQuery(validSpecialty?: MedicalSpecialty, locationIds?: string[]) {
    return this.prisma.user.findMany({
      where: {
        role: "DOCTOR",
        booking_url_slug: { not: null },
        is_suspended: false,
        doctor_profile: {
          verification_status: "APPROVED",
          ...(validSpecialty ? { specialty: validSpecialty } : {}),
        },
        ...(locationIds ? { id: { in: locationIds } } : {}),
      },
      select: {
        id: true,
        business_name: true,
        full_name: true,
        bio: true,
        address: true,
        booking_url_slug: true,
        avatar_url: true,
        doctor_profile: {
          select: { specialty: true, accepts_gessy: true, accepts_eopyy: true, verification_status: true },
        },
        services: {
          where: { is_active: true },
          select: { id: true, name: true, price: true },
          orderBy: { duration_minutes: "asc" },
          take: 3,
        },
        locations: {
          where: { is_active: true },
          select: { id: true, name: true, address: true },
          orderBy: [{ order: "asc" }, { created_at: "asc" }],
          take: 5,
        },
      },
      orderBy: { created_at: "asc" },
      take: 100,
    });
  }

  /** Returns a doctor's public profile (with active services and working hours) by booking slug. */
  async getProfile(slug: string) {
    const cached = profileCache.get(slug);
    if (cached && cached.expiresAt > Date.now())
      return cached.data as NonNullable<Awaited<ReturnType<typeof this.runProfileQuery>>>;

    const profile = await this.runProfileQuery(slug);
    if (!profile || profile.is_suspended || profile.doctor_profile?.verification_status !== "APPROVED") {
      throw new NotFoundException("Profile not found");
    }
    profileCache.set(slug, { data: profile, expiresAt: Date.now() + PROFILE_TTL });
    return profile;
  }

  /** The actual DB fetch for getProfile — kept separate so the cache type can be inferred from it. */
  private runProfileQuery(slug: string) {
    return this.prisma.user.findUnique({
      where: { booking_url_slug: slug },
      select: {
        id: true,
        full_name: true,
        business_name: true,
        bio: true,
        address: true,
        avatar_url: true,
        timezone: true,
        booking_url_slug: true,
        buffer_minutes: true,
        is_suspended: true,
        doctor_profile: {
          select: {
            specialty: true,
            latitude: true,
            longitude: true,
            accepts_gessy: true,
            accepts_eopyy: true,
            verification_status: true,
            medical_association_number: true,
            gender: true,
          },
        },
        services: {
          where: { is_active: true },
          include: { service_category: { select: { id: true, name: true, order: true } } },
          orderBy: [{ service_category: { order: "asc" } }, { created_at: "asc" }],
        },
        working_hours: true,
        doctor_photos: {
          orderBy: { order: "asc" as const },
          select: { id: true, url: true, order: true },
        },
        locations: {
          where: { is_active: true },
          select: {
            id: true,
            name: true,
            address: true,
            phone: true,
            lat: true,
            lng: true,
            location_services: {
              where: { is_active: true },
              select: { service_id: true, price_override: true, duration_override: true },
            },
          },
          orderBy: [{ order: "asc" }, { created_at: "asc" }],
        },
      },
    });
  }

  /**
   * Returns available HH:mm time slots for a given date and service duration.
   * Returns [] if the doctor doesn't work on that day.
   * excludeId skips an existing appointment (used during reschedule).
   */
  async getSlots(profileId: string, dateStr: string, durationMinutes: number, excludeId?: string, locationId?: string) {
    const selectedDate = this.parseDate(dateStr);
    const dayOfWeek = selectedDate.getDay();

    // A weekday can have several windows (split shift), so this is always a list.
    // Try location-specific hours first; fall back to global (location_id: null).
    let windows = await this.prisma.working_hours.findMany({
      where: { profile_id: profileId, day_of_week: dayOfWeek, is_enabled: true, location_id: locationId ?? null },
      orderBy: { start_time: "asc" },
    });
    if (windows.length === 0 && locationId) {
      windows = await this.prisma.working_hours.findMany({
        where: { profile_id: profileId, day_of_week: dayOfWeek, is_enabled: true, location_id: null },
        orderBy: { start_time: "asc" },
      });
    }
    if (windows.length === 0) return [];

    const [profile, location] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: profileId },
        select: { timezone: true, buffer_minutes: true, google_calendar_enabled: true },
      }),
      locationId
        ? this.prisma.locations.findUnique({ where: { id: locationId }, select: { timezone: true } })
        : Promise.resolve(null),
    ]);
    const timezone = resolveTimezone(profile?.timezone, location?.timezone);
    const bufferMinutes = profile?.buffer_minutes ?? 0;

    // Query bounds as the clinic-day's absolute instants (not server-local day),
    // so we don't miss appointments near the day's edges across the UTC offset.
    const dayStart = wallClockToUtc(dateStr, "00:00", timezone);
    const dayEnd = wallClockToUtc(dateStr, "23:59:59", timezone);

    const [blockedTimes, appointments, googleBusy] = await Promise.all([
      this.prisma.blocked_time.findMany({
        where: {
          profile_id: profileId,
          date: { gte: subHours(dayStart, 24), lte: addHours(dayEnd, 24) },
          OR: [{ location_id: null }, ...(locationId ? [{ location_id: locationId }] : [])],
        },
      }),
      this.prisma.appointments.findMany({
        where: {
          profile_id: profileId,
          status: { not: "cancelled" },
          start_time: { lt: dayEnd },
          end_time: { gt: dayStart },
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { start_time: true, end_time: true },
      }),
      this.fetchGoogleBusy(profileId, dayStart, dayEnd, profile?.google_calendar_enabled ?? false),
    ]);

    return this.computeSlots(
      selectedDate,
      windows,
      blockedTimes,
      [...appointments, ...googleBusy],
      durationMinutes,
      dateStr,
      timezone,
      bufferMinutes,
    );
  }

  /**
   * Batched version of getSlots: returns slots for `days` consecutive dates in a single
   * request (one DB round-trip per table) instead of one /slots call per day. Used by the
   * QuickBookModal's 7-day grid. Returns a map of `yyyy-MM-dd` → string[] of slot times.
   */
  async getSlotsRange(
    profileId: string,
    startDateStr: string,
    days: number,
    durationMinutes: number,
    locationId?: string,
  ): Promise<Record<string, string[]>> {
    const startDate = this.parseDate(startDateStr);

    const [profile, location] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: profileId },
        select: { timezone: true, buffer_minutes: true, google_calendar_enabled: true },
      }),
      locationId
        ? this.prisma.locations.findUnique({ where: { id: locationId }, select: { timezone: true } })
        : Promise.resolve(null),
    ]);
    const timezone = resolveTimezone(profile?.timezone, location?.timezone);
    const bufferMinutes = profile?.buffer_minutes ?? 0;

    // Whole-window bounds as absolute instants in the clinic timezone (±24h padding so
    // appointments/blocks near the day edges aren't dropped across the UTC offset).
    const lastDateStr = format(addDays(startDate, days - 1), "yyyy-MM-dd");
    const windowStart = subHours(wallClockToUtc(startDateStr, "00:00", timezone), 24);
    const windowEnd = addHours(wallClockToUtc(lastDateStr, "23:59:59", timezone), 24);

    const [workingHours, blockedTimes, appointmentsRaw, googleBusy] = await Promise.all([
      this.prisma.working_hours.findMany({
        where: {
          profile_id: profileId,
          is_enabled: true,
          OR: [{ location_id: null }, ...(locationId ? [{ location_id: locationId }] : [])],
        },
      }),
      this.prisma.blocked_time.findMany({
        where: {
          profile_id: profileId,
          date: { gte: windowStart, lte: windowEnd },
          OR: [{ location_id: null }, ...(locationId ? [{ location_id: locationId }] : [])],
        },
      }),
      this.prisma.appointments.findMany({
        where: {
          profile_id: profileId,
          status: { not: "cancelled" },
          start_time: { lt: windowEnd },
          end_time: { gt: windowStart },
        },
        select: { start_time: true, end_time: true },
      }),
      this.fetchGoogleBusy(profileId, windowStart, windowEnd, profile?.google_calendar_enabled ?? false),
    ]);
    // Google busy blocks join the real appointments so both fall out of every day's slots.
    // (fetchGoogleBusy already drops events BookPro itself mirrored, so no double-blocking.)
    const appointments = [...appointmentsRaw, ...googleBusy];

    // Per weekday, prefer the location-specific schedule, fall back to the global one —
    // same precedence as the single-date getSlots above. Returns ALL of that day's
    // windows, since a day may be split into a morning and an afternoon shift.
    const pickHours = (dow: number) => {
      if (locationId) {
        const own = workingHours.filter((w) => w.day_of_week === dow && w.location_id === locationId);
        if (own.length > 0) return own;
      }
      return workingHours.filter((w) => w.day_of_week === dow && w.location_id === null);
    };

    const result: Record<string, string[]> = {};
    for (let i = 0; i < days; i++) {
      const d = addDays(startDate, i);
      const dateStr = format(d, "yyyy-MM-dd");
      const windows = pickHours(d.getDay());
      result[dateStr] = windows.length
        ? this.computeSlots(d, windows, blockedTimes, appointments, durationMinutes, dateStr, timezone, bufferMinutes)
        : [];
    }
    return result;
  }

  /**
   * Creates a guest booking inside a SERIALIZABLE transaction to prevent double-booking.
   * Accepts one or more serviceIds; total duration is the sum of all service durations.
   * Sends a confirmation email asynchronously (failure is swallowed — doesn't affect the response).
   */
  async createBooking(dto: CreateBookingDto, patientId?: string) {
    // Core revenue flow — leave a trail so any error captured downstream
    // (booking conflict, email failure, 500) carries the booking context.
    Sentry.addBreadcrumb({
      category: "booking",
      message: `Booking attempt for doctor ${dto.profileId} at ${dto.date} ${dto.time}`,
      level: "info",
      data: { profileId: dto.profileId, locationId: dto.locationId, isGuest: !patientId },
    });

    const [doctor, bookingLocation] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: dto.profileId },
        select: {
          is_suspended: true,
          timezone: true,
          google_calendar_enabled: true,
          doctor_profile: { select: { verification_status: true } },
        },
      }),
      dto.locationId
        ? this.prisma.locations.findUnique({ where: { id: dto.locationId }, select: { timezone: true } })
        : Promise.resolve(null),
    ]);
    if (!doctor || doctor.is_suspended || doctor.doctor_profile?.verification_status !== "APPROVED") {
      throw new BadRequestException("Doctor is not available for booking");
    }

    const services = await this.prisma.services.findMany({
      where: { id: { in: dto.serviceIds }, profile_id: dto.profileId },
    });
    if (services.length !== dto.serviceIds.length) throw new BadRequestException("One or more services not found");

    // Interpret the patient's chosen wall-clock time in the clinic's timezone so
    // the stored instant is correct regardless of the server's timezone.
    const timezone = resolveTimezone(doctor.timezone, bookingLocation?.timezone);
    const totalDuration = services.reduce((sum, s) => sum + s.duration_minutes, 0);
    const startTime = wallClockToUtc(dto.date, dto.time, timezone);
    if (startTime < new Date()) throw new BadRequestException("Cannot book a slot in the past");
    const endTime = addMinutes(startTime, totalDuration);

    await this.validateWithinWorkingHours(dto.profileId, startTime, endTime, timezone, dto.locationId);
    await this.validateNotBlocked(dto.profileId, startTime, endTime, timezone, dto.locationId);
    await this.validateNotGoogleBusy(dto.profileId, startTime, endTime, doctor.google_calendar_enabled ?? false);

    const createAppointment = async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await this.prisma.$transaction(
            async (tx) => {
              const conflict = await tx.appointments.findFirst({
                where: {
                  profile_id: dto.profileId,
                  status: { in: ["pending", "confirmed"] },
                  AND: [{ start_time: { lt: endTime } }, { end_time: { gt: startTime } }],
                },
              });
              if (conflict) throw new ConflictException("This time slot is no longer available");

              return (tx.appointments as any).create({
                data: {
                  id: uuidv4(),
                  ref_number: generateRefCode(),
                  profile_id: dto.profileId,
                  patient_id: patientId ?? null,
                  location_id: dto.locationId ?? null,
                  client_name: dto.clientName,
                  client_email: dto.clientEmail,
                  client_phone: dto.clientPhone ?? null,
                  client_timezone: dto.clientTimezone ?? null,
                  start_time: startTime,
                  end_time: endTime,
                  status: "pending",
                  management_token: uuidv4(),
                  notes: dto.notes ?? null,
                  appointment_services: {
                    create: dto.serviceIds.map((serviceId) => ({ id: uuidv4(), service_id: serviceId })),
                  },
                },
                include: { profiles: true, appointment_services: { include: { service: true } } },
              });
            },
            { isolationLevel: "Serializable" },
          );
        } catch (err: any) {
          const isRefNumberCollision =
            err?.code === "P2002" &&
            (err?.meta?.target?.includes("ref_number") ||
              err?.meta?.driverAdapterError?.cause?.constraint?.fields?.includes("ref_number"));
          if (isRefNumberCollision) {
            console.warn(`[ref_number] collision on attempt ${attempt + 1}, retrying...`);
            Sentry.addBreadcrumb({
              category: "booking",
              message: `ref_number collision, retry ${attempt + 1}`,
              level: "warning",
            });
            if (attempt < 4) continue;
            throw new BadRequestException("Could not generate unique booking reference, please try again");
          }
          throw err;
        }
      }
    };

    const [appointment, location] = await Promise.all([
      Sentry.startSpan({ name: "booking.createAppointment", op: "db.transaction" }, () => createAppointment()),
      dto.locationId
        ? this.prisma.locations.findUnique({
            where: { id: dto.locationId },
            select: { name: true, address: true, lat: true, lng: true },
          })
        : Promise.resolve(null),
    ]);

    const serviceNames = services.map((s) => s.name).join(", ");
    const doctor_profile = (appointment as any).profiles as any;

    // Push real-time notification to the doctor's SSE stream (fire-and-forget)
    this.events.emit(appointment.profile_id, {
      type: "new_appointment",
      id: appointment.id,
      profile_id: appointment.profile_id,
      client_name: appointment.client_name,
      client_email: appointment.client_email,
      client_phone: appointment.client_phone,
      client_timezone: appointment.client_timezone,
      start_time: appointment.start_time,
      end_time: appointment.end_time,
      status: appointment.status,
      notes: appointment.notes,
      management_token: appointment.management_token,
      appointment_services: (appointment as any).appointment_services,
    });

    // Push to the doctor's Google Calendar (direction BookPro→Google), fire-and-forget:
    // a Google failure must never break the booking. The event id is stored so we
    // can later update/delete on reschedule/cancel.
    void this.googleCalendar
      .createEvent(
        appointment.profile_id,
        this.buildEventInput({
          clientName: appointment.client_name,
          serviceNames,
          refNumber: appointment.ref_number,
          clientPhone: appointment.client_phone,
          notes: appointment.notes,
          locationName: location?.name,
          locationAddress: location?.address,
          start: appointment.start_time,
          end: appointment.end_time,
          timeZone: timezone,
        }),
      )
      .then((eventId) => {
        if (eventId) {
          return this.prisma.appointments.update({
            where: { id: appointment.id },
            data: { google_event_id: eventId },
          });
        }
      })
      .catch(() => null);

    const appUrl = this.config.get<string>("appUrl") ?? "http://localhost:3000";

    let mapsUrl: string | undefined;
    if (location) {
      mapsUrl =
        location.lat && location.lng
          ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
          : location.address
            ? `https://maps.google.com/?q=${encodeURIComponent(location.address)}`
            : undefined;
    }

    this.email
      .sendBookingConfirmation({
        to: dto.clientEmail,
        clientName: dto.clientName,
        businessName: doctor_profile?.business_name ?? doctor_profile?.full_name ?? "BookPro",
        serviceName: serviceNames,
        date: dto.date,
        time: dto.time,
        managementToken: appointment.management_token,
        appUrl,
        refNumber: appointment.ref_number,
        locationName: location?.name,
        locationAddress: location?.address ?? undefined,
        mapsUrl,
      })
      .catch(() => null);

    this.email
      .sendNewAppointmentToDoctor({
        to: doctor_profile?.email,
        doctorName: doctor_profile?.full_name ?? doctor_profile?.business_name ?? "Γιατρέ",
        clientName: dto.clientName,
        clientPhone: dto.clientPhone ?? null,
        serviceName: serviceNames,
        date: format(startTime, "dd/MM/yyyy"),
        time: format(startTime, "HH:mm"),
        notes: dto.notes ?? null,
        appUrl,
        refNumber: appointment.ref_number,
      })
      .catch(() => null);

    Sentry.addBreadcrumb({
      category: "booking",
      message: `Booking created ${appointment.ref_number}`,
      level: "info",
      data: { appointmentId: appointment.id },
    });

    return { success: true, appointmentId: appointment.id, management_token: appointment.management_token };
  }

  /** Looks up a booking by its management token (included in confirmation emails for self-service actions). */
  async getBookingByToken(token: string) {
    const appt = await (this.prisma.appointments as any).findUnique({
      where: { management_token: token },
      include: {
        appointment_services: { include: { service: true } },
        profiles: {
          select: {
            id: true,
            full_name: true,
            business_name: true,
            avatar_url: true,
            booking_url_slug: true,
            working_hours: true,
          },
        },
      },
    });
    if (!appt) throw new NotFoundException("Booking not found");
    return appt;
  }

  /** Cancels a booking via management token (client self-service, no auth required). */
  async cancelBooking(token: string) {
    const appt = await (this.prisma.appointments as any).findUnique({
      where: { management_token: token },
      include: {
        appointment_services: { include: { service: true } },
        profiles: { select: { email: true, full_name: true, business_name: true, booking_url_slug: true } },
      },
    });
    if (!appt) throw new NotFoundException("Booking not found");
    if (appt.status === "cancelled") throw new BadRequestException("Already cancelled");

    await this.prisma.appointments.update({
      where: { id: appt.id },
      data: { status: "cancelled", cancelled_by: "client", updated_at: new Date() },
    });

    this.events.emit(appt.profile_id, {
      type: "appointment_cancelled",
      id: appt.id,
      status: "cancelled",
      cancelled_by: "client",
    });

    // Remove the mirrored event from the doctor's Google Calendar (fire-and-forget).
    if (appt.google_event_id) {
      void this.googleCalendar.deleteEvent(appt.profile_id, appt.google_event_id).catch(() => null);
    }

    const profile = appt.profiles as any;
    const date = format(appt.start_time, "dd/MM/yyyy");
    const time = format(appt.start_time, "HH:mm");
    const businessName = profile.full_name ?? profile.business_name ?? "Ο γιατρός σας";
    const serviceNames = (appt.appointment_services as any[]).map((as: any) => as.service.name).join(", ");

    this.email
      .sendCancellationNotificationToDoctor({
        to: profile.email,
        doctorName: businessName,
        clientName: appt.client_name,
        serviceName: serviceNames,
        date,
        time,
        refNumber: appt.ref_number,
      })
      .catch(() => null);

    const appUrl = this.config.get<string>("appUrl") ?? "http://localhost:3000";
    const bookingUrl = profile.booking_url_slug ? `${appUrl}/book/${profile.booking_url_slug}` : undefined;

    this.email
      .sendPatientCancellationConfirmation({
        to: appt.client_email,
        clientName: appt.client_name,
        businessName,
        serviceName: serviceNames,
        date,
        time,
        refNumber: appt.ref_number,
        bookingUrl,
      })
      .catch(() => null);

    return { message: "Booking cancelled" };
  }

  /** Reschedules a booking via management token. Checks for conflicts at the new slot before saving. */
  async rescheduleBooking(token: string, dto: RescheduleBookingDto) {
    const appt = await (this.prisma.appointments as any).findUnique({
      where: { management_token: token },
      include: {
        appointment_services: { include: { service: true } },
        profiles: {
          select: {
            email: true,
            full_name: true,
            business_name: true,
            booking_url_slug: true,
            timezone: true,
            google_calendar_enabled: true,
          },
        },
      },
    });
    if (!appt) throw new NotFoundException("Booking not found");
    if (appt.status === "cancelled") throw new BadRequestException("Cannot reschedule a cancelled booking");

    const location = appt.location_id
      ? await this.prisma.locations.findUnique({ where: { id: appt.location_id }, select: { timezone: true } })
      : null;
    const timezone = resolveTimezone(appt.profiles?.timezone, location?.timezone);

    const totalDuration = (appt.appointment_services as any[]).reduce(
      (sum: number, as: any) => sum + (as.service.duration_minutes ?? 30),
      0,
    );
    const newStart = wallClockToUtc(dto.date, dto.time, timezone);
    if (newStart < new Date()) throw new BadRequestException("Cannot reschedule to a slot in the past");
    const newEnd = addMinutes(newStart, totalDuration || 30);

    await this.validateWithinWorkingHours(appt.profile_id, newStart, newEnd, timezone, appt.location_id ?? undefined);
    await this.validateNotBlocked(appt.profile_id, newStart, newEnd, timezone, appt.location_id ?? undefined);
    await this.validateNotGoogleBusy(
      appt.profile_id,
      newStart,
      newEnd,
      appt.profiles?.google_calendar_enabled ?? false,
    );

    await this.prisma.$transaction(
      async (tx) => {
        const conflict = await tx.appointments.findFirst({
          where: {
            profile_id: appt.profile_id,
            status: { in: ["pending", "confirmed"] },
            id: { not: appt.id },
            AND: [{ start_time: { lt: newEnd } }, { end_time: { gt: newStart } }],
          },
        });
        if (conflict) throw new ConflictException("This time slot is not available");

        await tx.appointments.update({
          where: { id: appt.id },
          data: { start_time: newStart, end_time: newEnd, status: "pending", updated_at: new Date() },
        });
      },
      { isolationLevel: "Serializable" },
    );

    this.events.emit(appt.profile_id, {
      type: "appointment_rescheduled",
      id: appt.id,
      start_time: newStart,
      end_time: newEnd,
      status: "pending",
    });

    const doctor = (appt as any).profiles as { email: string; full_name: string | null; business_name: string | null };
    const businessName = doctor.full_name ?? doctor.business_name ?? "Ο γιατρός σας";
    const appUrl = this.config.get<string>("appUrl") ?? "http://localhost:3000";
    const serviceNames = (appt.appointment_services as any[]).map((as: any) => as.service.name).join(", ");

    // Move the mirrored Google Calendar event to the new time (fire-and-forget).
    if (appt.google_event_id) {
      void this.googleCalendar
        .updateEvent(
          appt.profile_id,
          appt.google_event_id,
          this.buildEventInput({
            clientName: appt.client_name,
            serviceNames,
            refNumber: appt.ref_number,
            clientPhone: appt.client_phone,
            notes: appt.notes,
            start: newStart,
            end: newEnd,
            timeZone: timezone,
          }),
        )
        .catch(() => null);
    }

    this.email
      .sendRescheduleNotificationToDoctor({
        to: doctor.email,
        doctorName: businessName,
        clientName: appt.client_name,
        serviceName: serviceNames,
        oldDate: format(appt.start_time, "dd/MM/yyyy"),
        oldTime: format(appt.start_time, "HH:mm"),
        newDate: format(newStart, "dd/MM/yyyy"),
        newTime: format(newStart, "HH:mm"),
        refNumber: appt.ref_number,
      })
      .catch(() => null);

    this.email
      .sendRescheduleConfirmationToPatient({
        to: appt.client_email,
        clientName: appt.client_name,
        businessName,
        serviceName: serviceNames,
        newDate: format(newStart, "dd/MM/yyyy"),
        newTime: format(newStart, "HH:mm"),
        managementToken: appt.management_token,
        appUrl,
        refNumber: appt.ref_number,
      })
      .catch(() => null);

    return { message: "Booking rescheduled" };
  }

  /**
   * Finds up to 3 available dates before and after a base date (within ±20 days).
   * Used by the booking wizard to surface smart date suggestions when a day has no slots.
   * Fetches all data once and runs slot computation in-memory to avoid N+1 queries.
   * When locationId is provided, only considers working hours for that specific location.
   */
  async findNearestDates(profileId: string, baseDateStr: string, durationMinutes: number, locationId?: string) {
    const baseDate = this.parseDate(baseDateStr);
    const MAX = 20;
    const REQUIRED = 5;
    const searchStart = subHours(startOfDay(addDays(baseDate, -MAX)), 12);
    const searchEnd = addHours(endOfDay(addDays(baseDate, MAX)), 12);

    const [workingHours, blockedTimes, appointments, profile, location] = await Promise.all([
      this.prisma.working_hours.findMany({
        where: {
          profile_id: profileId,
          is_enabled: true,
          ...(locationId ? { location_id: locationId } : {}),
        },
      }),
      this.prisma.blocked_time.findMany({
        where: {
          profile_id: profileId,
          date: { gte: searchStart, lte: searchEnd },
          OR: [{ location_id: null }, ...(locationId ? [{ location_id: locationId }] : [])],
        },
      }),
      this.prisma.appointments.findMany({
        where: {
          profile_id: profileId,
          status: { not: "cancelled" },
          start_time: { gte: searchStart, lt: searchEnd },
        },
        select: { start_time: true, end_time: true },
      }),
      this.prisma.user.findUnique({ where: { id: profileId }, select: { timezone: true, buffer_minutes: true } }),
      locationId
        ? this.prisma.locations.findUnique({ where: { id: locationId }, select: { timezone: true } })
        : Promise.resolve(null),
    ]);

    const timezone = resolveTimezone(profile?.timezone, location?.timezone);
    const bufferMinutes = profile?.buffer_minutes ?? 0;
    const todayStr = todayStrInTz(timezone);

    const getSlotsForDate = (d: Date): string[] => {
      const windows = workingHours.filter((w) => w.day_of_week === d.getDay());
      if (windows.length === 0) return [];
      return this.computeSlots(
        d,
        windows,
        blockedTimes,
        appointments,
        durationMinutes,
        format(d, "yyyy-MM-dd"),
        timezone,
        bufferMinutes,
      );
    };

    const nextDates: string[] = [];
    const prevDates: string[] = [];
    const slots: Record<string, string[]> = {};
    let offset = 1;

    while (nextDates.length < REQUIRED && offset <= MAX) {
      const d = addDays(baseDate, offset++);
      const s = getSlotsForDate(d);
      if (s.length > 0) {
        const key = format(d, "yyyy-MM-dd");
        nextDates.push(key);
        slots[key] = s;
      }
    }
    offset = 1;
    while (prevDates.length < REQUIRED && offset <= MAX) {
      const d = addDays(baseDate, -offset++);
      if (format(d, "yyyy-MM-dd") < todayStr) break;
      const s = getSlotsForDate(d);
      if (s.length > 0) {
        const key = format(d, "yyyy-MM-dd");
        prevDates.push(key);
        slots[key] = s;
      }
    }

    return { nextDates, prevDates: prevDates.sort(), slots };
  }

  /**
   * Core slot computation: generates the slots of every open window on that day
   * (a weekday can have several — split shift), skips slots that overlap with
   * booked appointments or blocked times, and skips past slots when the
   * requested date is today (clinic timezone).
   */
  private computeSlots(
    _date: Date,
    windows: any[],
    blockedTimes: any[],
    appointments: any[],
    duration: number,
    dateStr: string,
    timezone: string = CLINIC_DEFAULT_TZ,
    bufferMinutes: number = 0,
  ): string[] {
    // All slot math lives in a pure, timezone-explicit helper so it stays
    // correct regardless of the server's local timezone (and is unit-testable).
    return computeDaySlots({
      dateStr,
      tz: timezone,
      windows,
      blocked: blockedTimes,
      appointments,
      durationMinutes: duration,
      bufferMinutes,
    });
  }

  /** Throws if startTime–endTime falls outside the doctor's working hours for that day (in clinic tz). */
  private async validateWithinWorkingHours(
    profileId: string,
    startTime: Date,
    endTime: Date,
    timezone: string,
    locationId?: string,
  ): Promise<void> {
    // Weekday + calendar date of the appointment as they read in the clinic's
    // timezone — not server-local — so a near-midnight booking lands on the right day.
    const dayOfWeek = dayOfWeekInTz(startTime, timezone);
    const dateStr = dateStrInTz(startTime, timezone);

    // Try location-specific hours first; fall back to global (location_id: null)
    let windows = await this.prisma.working_hours.findMany({
      where: { profile_id: profileId, day_of_week: dayOfWeek, is_enabled: true, location_id: locationId ?? null },
    });
    if (windows.length === 0 && locationId) {
      windows = await this.prisma.working_hours.findMany({
        where: { profile_id: profileId, day_of_week: dayOfWeek, is_enabled: true, location_id: null },
      });
    }
    if (windows.length === 0) throw new ConflictException("This time slot is no longer available");

    // Must fit inside ONE window — a booking may not straddle the gap between
    // the morning and the afternoon shift.
    if (!fitsInAnyWindow(windows, dateStr, timezone, startTime.getTime(), endTime.getTime())) {
      throw new ConflictException("This time slot is no longer available");
    }
  }

  /**
   * Throws if startTime–endTime overlaps a blocked time slot. Blocked rows are wall-clock
   * (date + HH:mm), so they're converted to absolute instants in the clinic tz before
   * comparing against the booking's UTC instants. Considers the location's blocks plus
   * the doctor's global (location_id: null) blocks — mirrors the slots computation.
   */
  private async validateNotBlocked(
    profileId: string,
    startTime: Date,
    endTime: Date,
    timezone: string,
    locationId?: string,
  ): Promise<void> {
    const blocked = await this.prisma.blocked_time.findMany({
      where: {
        profile_id: profileId,
        // ±24h padding so blocks near the day edges aren't missed across the UTC offset.
        date: { gte: subHours(startTime, 24), lte: addHours(endTime, 24) },
        OR: [{ location_id: null }, ...(locationId ? [{ location_id: locationId }] : [])],
      },
    });

    const s = startTime.getTime();
    const e = endTime.getTime();
    const overlaps = blocked.some((b) => {
      const d = dateOnly(b.date);
      const bStart = wallClockToUtc(d, timeOfDay(b.start_time), timezone).getTime();
      const bEnd = wallClockToUtc(d, timeOfDay(b.end_time), timezone).getTime();
      return s < bEnd && bStart < e;
    });
    if (overlaps) throw new ConflictException("This time slot is no longer available");
  }

  /**
   * Returns the next `limit` available slots for a doctor, using their shortest service duration.
   */
  async getNextSlots(slug: string, limit: number = 3): Promise<{ date: string; time: string }[]> {
    const profileId = await this.resolveProfileId(slug);

    const [shortestService] = await this.prisma.services.findMany({
      where: { profile_id: profileId, is_active: true },
      select: { duration_minutes: true },
      orderBy: { duration_minutes: "asc" },
      take: 1,
    });
    const duration = shortestService?.duration_minutes ?? 30;

    const baseDateStr = format(new Date(), "yyyy-MM-dd");
    const { nextDates, slots } = await this.findNearestDates(profileId, baseDateStr, duration);

    const result: { date: string; time: string }[] = [];
    for (const date of nextDates) {
      for (const time of slots[date] ?? []) {
        result.push({ date, time });
        if (result.length >= limit) return result;
      }
    }
    return result;
  }

  /**
   * Returns the next `limit` available dates with the first available slot of each day.
   * Used by the search results page to show the doctolib-style date grid.
   * When locationId is provided, only shows availability for that specific location.
   */
  async getAvailabilityDates(
    slug: string,
    limit: number = 6,
    locationId?: string,
  ): Promise<{ date: string; firstSlot: string }[]> {
    // Stage 1: resolve the slug AND fetch timezone/buffer in a single round-trip.
    // (Avoids resolveProfileId's separate query + findNearestDates' own user lookup.)
    const profile = await this.prisma.user.findUnique({
      where: { booking_url_slug: slug },
      select: {
        id: true,
        is_suspended: true,
        timezone: true,
        buffer_minutes: true,
        doctor_profile: { select: { verification_status: true } },
      },
    });
    if (!profile || profile.is_suspended || profile.doctor_profile?.verification_status !== "APPROVED") {
      throw new NotFoundException("Profile not found");
    }
    const profileId = profile.id;

    const cacheKey = `${profileId}:${limit}:${locationId ?? "all"}`;
    const cached = availCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    // Window: forward-only (this endpoint never needs past dates), ±12h padding so
    // we don't drop appointments/blocks near the day edges across the UTC offset.
    const MAX_DAYS = 20;
    const today = new Date();
    const searchStart = subHours(startOfDay(today), 12);
    const searchEnd = addHours(endOfDay(addDays(today, MAX_DAYS)), 12);

    // Stage 2: everything else in one parallel batch.
    const [shortestService, workingHours, blockedTimes, appointments, location] = await Promise.all([
      this.prisma.services.findFirst({
        where: { profile_id: profileId, is_active: true },
        select: { duration_minutes: true },
        orderBy: { duration_minutes: "asc" },
      }),
      this.prisma.working_hours.findMany({
        where: {
          profile_id: profileId,
          is_enabled: true,
          ...(locationId ? { location_id: locationId } : {}),
        },
      }),
      this.prisma.blocked_time.findMany({
        where: {
          profile_id: profileId,
          date: { gte: searchStart, lte: searchEnd },
          OR: [{ location_id: null }, ...(locationId ? [{ location_id: locationId }] : [])],
        },
      }),
      this.prisma.appointments.findMany({
        where: {
          profile_id: profileId,
          status: { not: "cancelled" },
          start_time: { gte: searchStart, lt: searchEnd },
        },
        select: { start_time: true, end_time: true },
      }),
      locationId
        ? this.prisma.locations.findUnique({ where: { id: locationId }, select: { timezone: true } })
        : Promise.resolve(null),
    ]);

    const duration = shortestService?.duration_minutes ?? 30;
    const timezone = resolveTimezone(profile.timezone, location?.timezone);
    const bufferMinutes = profile.buffer_minutes ?? 0;

    // Walk forward in memory until we have `limit` dates with at least one open slot.
    const result: { date: string; firstSlot: string }[] = [];
    for (let offset = 1; offset <= MAX_DAYS && result.length < limit; offset++) {
      const d = addDays(today, offset);
      const windows = workingHours.filter((w) => w.day_of_week === d.getDay());
      if (windows.length === 0) continue;
      const dateStr = format(d, "yyyy-MM-dd");
      const slots = this.computeSlots(d, windows, blockedTimes, appointments, duration, dateStr, timezone, bufferMinutes);
      if (slots.length > 0) result.push({ date: dateStr, firstSlot: slots[0] });
    }

    availCache.set(cacheKey, { data: result, expiresAt: Date.now() + AVAIL_TTL });
    return result;
  }

  /**
   * All-locations version of getAvailabilityDates for ONE doctor: returns availability
   * dates for every active location in a single request (2 DB round-trips total) instead
   * of one request per location. Keyed by location id. Results are also written into
   * availCache per location so the single-location endpoint serves them from cache.
   */
  async getAvailabilityDatesAllLocations(
    slug: string,
    limit: number = 6,
  ): Promise<Record<string, { date: string; firstSlot: string }[]>> {
    // Stage 1: resolve slug + timezone/buffer in one round-trip.
    const profile = await this.prisma.user.findUnique({
      where: { booking_url_slug: slug },
      select: {
        id: true,
        is_suspended: true,
        timezone: true,
        buffer_minutes: true,
        doctor_profile: { select: { verification_status: true } },
      },
    });
    if (!profile || profile.is_suspended || profile.doctor_profile?.verification_status !== "APPROVED") {
      throw new NotFoundException("Profile not found");
    }
    const profileId = profile.id;

    const MAX_DAYS = 20;
    const today = new Date();
    const searchStart = subHours(startOfDay(today), 12);
    const searchEnd = addHours(endOfDay(addDays(today, MAX_DAYS)), 12);

    // Stage 2: fetch every location's data for this doctor in one parallel batch.
    const [shortestService, allHours, allBlocked, appointments, locations] = await Promise.all([
      this.prisma.services.findFirst({
        where: { profile_id: profileId, is_active: true },
        select: { duration_minutes: true },
        orderBy: { duration_minutes: "asc" },
      }),
      this.prisma.working_hours.findMany({
        where: { profile_id: profileId, is_enabled: true },
      }),
      this.prisma.blocked_time.findMany({
        where: { profile_id: profileId, date: { gte: searchStart, lte: searchEnd } },
      }),
      this.prisma.appointments.findMany({
        where: {
          profile_id: profileId,
          status: { not: "cancelled" },
          start_time: { gte: searchStart, lt: searchEnd },
        },
        select: { start_time: true, end_time: true },
      }),
      this.prisma.locations.findMany({
        where: { profile_id: profileId, is_active: true },
        select: { id: true, timezone: true },
      }),
    ]);

    const duration = shortestService?.duration_minutes ?? 30;
    const bufferMinutes = profile.buffer_minutes ?? 0;

    const result: Record<string, { date: string; firstSlot: string }[]> = {};

    for (const loc of locations) {
      const cacheKey = `${profileId}:${limit}:${loc.id}`;
      const cached = availCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        result[loc.id] = cached.data;
        continue;
      }

      // Strict per-location hours (matches the single-location endpoint). Blocked
      // includes both this location's blocks and the doctor's global (null) blocks.
      const hours = allHours.filter((h) => h.location_id === loc.id);
      const blocked = allBlocked.filter((b) => b.location_id === loc.id || b.location_id === null);
      const timezone = resolveTimezone(profile.timezone, loc.timezone);

      const dates: { date: string; firstSlot: string }[] = [];
      for (let offset = 1; offset <= MAX_DAYS && dates.length < limit; offset++) {
        const d = addDays(today, offset);
        const windows = hours.filter((w) => w.day_of_week === d.getDay());
        if (windows.length === 0) continue;
        const dateStr = format(d, "yyyy-MM-dd");
        const slots = this.computeSlots(d, windows, blocked, appointments, duration, dateStr, timezone, bufferMinutes);
        if (slots.length > 0) dates.push({ date: dateStr, firstSlot: slots[0] });
      }

      availCache.set(cacheKey, { data: dates, expiresAt: Date.now() + AVAIL_TTL });
      result[loc.id] = dates;
    }

    return result;
  }

  /**
   * Batch version of getAvailabilityDates for multiple doctors at once.
   * Replaces N×6 individual DB queries with 5 parallel queries regardless of doctor count.
   * Only returns data for APPROVED + not suspended doctors (security enforced at query level).
   * Returns { [slug]: { date, firstSlot }[] } keyed by booking_url_slug.
   */
  async getAvailabilityBatch(
    slugs: string[],
    limit = 6,
  ): Promise<Record<string, { date: string; firstSlot: string }[]>> {
    if (slugs.length === 0) return {};

    // 1. Resolve slugs → profiles with security filter (APPROVED + not suspended)
    const profiles = await this.prisma.user.findMany({
      where: {
        booking_url_slug: { in: slugs },
        is_suspended: false,
        doctor_profile: { verification_status: "APPROVED" },
      },
      select: { id: true, booking_url_slug: true, timezone: true, buffer_minutes: true },
    });

    if (profiles.length === 0) return {};

    const profileIds = profiles.map((p) => p.id);
    const today = new Date();
    const searchStart = subHours(startOfDay(today), 12);
    const searchEnd = addHours(endOfDay(addDays(today, 20)), 12);

    // 2–5. Fetch all availability data in 4 parallel queries (independent of doctor count)
    const [allServices, allWorkingHours, allBlocked, allAppointments] = await Promise.all([
      this.prisma.services.findMany({
        where: { profile_id: { in: profileIds }, is_active: true },
        select: { profile_id: true, duration_minutes: true },
        orderBy: { duration_minutes: "asc" },
      }),
      this.prisma.working_hours.findMany({
        where: { profile_id: { in: profileIds }, is_enabled: true },
      }),
      this.prisma.blocked_time.findMany({
        where: { profile_id: { in: profileIds }, date: { gte: searchStart, lte: searchEnd } },
      }),
      this.prisma.appointments.findMany({
        where: {
          profile_id: { in: profileIds },
          status: { not: "cancelled" },
          start_time: { gte: searchStart, lt: searchEnd },
        },
        select: { profile_id: true, start_time: true, end_time: true },
      }),
    ]);

    // Group all data by profile_id in memory (O(n) passes)
    const minDuration = new Map<string, number>();
    for (const s of allServices) {
      if (!minDuration.has(s.profile_id)) minDuration.set(s.profile_id, s.duration_minutes);
    }

    const hoursByProfile = new Map<string, typeof allWorkingHours>();
    for (const wh of allWorkingHours) {
      const arr = hoursByProfile.get(wh.profile_id) ?? [];
      arr.push(wh);
      hoursByProfile.set(wh.profile_id, arr);
    }

    const blockedByProfile = new Map<string, typeof allBlocked>();
    for (const b of allBlocked) {
      const arr = blockedByProfile.get(b.profile_id) ?? [];
      arr.push(b);
      blockedByProfile.set(b.profile_id, arr);
    }

    const apptsByProfile = new Map<string, { profile_id: string; start_time: Date; end_time: Date }[]>();
    for (const a of allAppointments) {
      const arr = apptsByProfile.get(a.profile_id) ?? [];
      arr.push(a);
      apptsByProfile.set(a.profile_id, arr);
    }

    // Compute slots per profile entirely in memory
    const result: Record<string, { date: string; firstSlot: string }[]> = {};
    const MAX_DAYS = 20;

    for (const profile of profiles) {
      const slug = profile.booking_url_slug!;
      const duration = minDuration.get(profile.id) ?? 30;
      const hours = hoursByProfile.get(profile.id) ?? [];
      const blocked = blockedByProfile.get(profile.id) ?? [];
      const appointments = apptsByProfile.get(profile.id) ?? [];
      const timezone = resolveTimezone(profile.timezone);
      const bufferMinutes = profile.buffer_minutes ?? 0;

      const dates: { date: string; firstSlot: string }[] = [];
      let offset = 1;

      while (dates.length < limit && offset <= MAX_DAYS) {
        const d = addDays(today, offset++);
        const windows = hours.filter((h) => h.day_of_week === d.getDay());
        if (windows.length === 0) continue;
        const dateStr = format(d, "yyyy-MM-dd");
        const slots = this.computeSlots(d, windows, blocked, appointments, duration, dateStr, timezone, bufferMinutes);
        if (slots.length > 0) dates.push({ date: dateStr, firstSlot: slots[0] });
      }

      result[slug] = dates;
    }

    return result;
  }

  /** Resolves a booking slug to a profile id, enforcing APPROVED + not suspended. */
  async resolveProfileId(slug: string): Promise<string> {
    const profile = await this.prisma.user.findUnique({
      where: { booking_url_slug: slug },
      select: { id: true, is_suspended: true, doctor_profile: { select: { verification_status: true } } },
    });
    if (!profile || profile.is_suspended || profile.doctor_profile?.verification_status !== "APPROVED") {
      throw new NotFoundException("Profile not found");
    }
    return profile.id;
  }

  /** Parses a YYYY-MM-DD string as a local Date without timezone offset issues. */
  private parseDate(dateStr: string): Date {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
}
