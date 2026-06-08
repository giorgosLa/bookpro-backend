import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MedicalSpecialty } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { EmailService } from '@/email/email.service';
import { EventsService } from '@/events/events.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { RescheduleBookingDto } from './dto/reschedule-booking.dto';
import {
  addMinutes,
  addDays,
  format,
  startOfDay,
  endOfDay,
  addHours,
  subHours,
} from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { v4 as uuidv4 } from 'uuid';

const availCache = new Map<string, { data: { date: string; firstSlot: string }[]; expiresAt: number }>()
const AVAIL_TTL = 2 * 60 * 1000 // 2 minutes

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private config: ConfigService,
    private events: EventsService,
  ) {}

  /** Returns all registered doctors who have a booking slug. Optionally filters by specialty enum. */
  async getDoctors(specialty?: string) {
    const validSpecialty = specialty && Object.values(MedicalSpecialty).includes(specialty as MedicalSpecialty)
      ? (specialty as MedicalSpecialty)
      : undefined;

    const doctors = await this.prisma.user.findMany({
      where: {
        role: 'DOCTOR',
        booking_url_slug: { not: null },
        ...(validSpecialty ? { doctor_profile: { specialty: validSpecialty } } : {}),
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
          orderBy: { duration_minutes: 'asc' },
          take: 3,
        },
      },
      orderBy: { created_at: 'asc' },
      take: 100,
    });
    return doctors;
  }

  /** Returns a doctor's public profile (with active services and working hours) by booking slug. */
  async getProfile(slug: string) {
    const profile = await this.prisma.user.findUnique({
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
        doctor_profile: {
          select: { specialty: true, latitude: true, longitude: true, accepts_gessy: true, accepts_eopyy: true, verification_status: true, license_number: true },
        },
        services: {
          where: { is_active: true },
          include: { service_category: { select: { id: true, name: true, order: true } } },
          orderBy: [
            { service_category: { order: 'asc' } },
            { created_at: 'asc' },
          ],
        },
        working_hours: true,
      },
    });
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  /**
   * Returns available HH:mm time slots for a given date and service duration.
   * Returns [] if the doctor doesn't work on that day.
   * excludeId skips an existing appointment (used during reschedule).
   */
  async getSlots(profileId: string, dateStr: string, durationMinutes: number, excludeId?: string) {
    const selectedDate = this.parseDate(dateStr);
    const dayOfWeek = selectedDate.getDay();

    const wh = await this.prisma.working_hours.findFirst({
      where: { profile_id: profileId, day_of_week: dayOfWeek, is_enabled: true },
    });
    if (!wh) return [];

    const dayStart = startOfDay(selectedDate);
    const dayEnd = endOfDay(selectedDate);

    const [blockedTimes, appointments, profile] = await Promise.all([
      this.prisma.blocked_time.findMany({
        where: {
          profile_id: profileId,
          date: { gte: subHours(dayStart, 12), lte: addHours(dayEnd, 12) },
        },
      }),
      this.prisma.appointments.findMany({
        where: {
          profile_id: profileId,
          status: { not: 'cancelled' },
          start_time: { lt: dayEnd },
          end_time: { gt: dayStart },
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { start_time: true, end_time: true },
      }),
      this.prisma.user.findUnique({ where: { id: profileId }, select: { timezone: true, buffer_minutes: true } }),
    ]);

    const timezone = profile?.timezone ?? 'UTC';
    const bufferMinutes = profile?.buffer_minutes ?? 0;
    return this.computeSlots(selectedDate, wh, blockedTimes, appointments, durationMinutes, dateStr, timezone, bufferMinutes);
  }

  /**
   * Creates a guest booking inside a SERIALIZABLE transaction to prevent double-booking.
   * Sends a confirmation email asynchronously (failure is swallowed — doesn't affect the response).
   */
  async createBooking(dto: CreateBookingDto, patientId?: string) {
    const service = await this.prisma.services.findUnique({
      where: { id: dto.serviceId, profile_id: dto.profileId },
    });
    if (!service) throw new BadRequestException('Service not found');

    const startTime = new Date(`${dto.date}T${dto.time}:00`);
    if (startTime < new Date()) throw new BadRequestException('Cannot book a slot in the past');
    const endTime = addMinutes(startTime, service.duration_minutes);

    await this.validateWithinWorkingHours(dto.profileId, startTime, endTime);

    const appointment = await this.prisma.$transaction(
      async (tx) => {
        const conflict = await tx.appointments.findFirst({
          where: {
            profile_id: dto.profileId,
            status: { in: ['pending', 'confirmed'] },
            AND: [{ start_time: { lt: endTime } }, { end_time: { gt: startTime } }],
          },
        });
        if (conflict) throw new ConflictException('This time slot is no longer available');

        return tx.appointments.create({
          data: {
            id: uuidv4(),
            profile_id: dto.profileId,
            patient_id: patientId ?? null,
            service_id: dto.serviceId,
            client_name: dto.clientName,
            client_email: dto.clientEmail,
            client_phone: dto.clientPhone ?? null,
            client_timezone: dto.clientTimezone ?? null,
            start_time: startTime,
            end_time: endTime,
            status: 'pending',
            management_token: uuidv4(),
            notes: dto.notes ?? null,
          },
          include: { services: true, profiles: true },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    // Push real-time notification to the doctor's SSE stream (fire-and-forget)
    this.events.emit(appointment.profile_id, {
      id: appointment.id,
      profile_id: appointment.profile_id,
      service_id: appointment.service_id,
      client_name: appointment.client_name,
      client_email: appointment.client_email,
      client_phone: appointment.client_phone,
      client_timezone: appointment.client_timezone,
      start_time: appointment.start_time,
      end_time: appointment.end_time,
      status: appointment.status,
      notes: appointment.notes,
      management_token: appointment.management_token,
      services: (appointment as any).services,
    });

    const appUrl = this.config.get<string>('appUrl') ?? 'http://localhost:3000';
    this.email
      .sendBookingConfirmation({
        to: dto.clientEmail,
        clientName: dto.clientName,
        businessName: (appointment as any).profiles?.business_name ?? 'BookPro',
        serviceName: service.name,
        date: dto.date,
        time: dto.time,
        managementToken: appointment.management_token,
        appUrl,
      })
      .catch(() => null);

    return { success: true, appointmentId: appointment.id };
  }

  /** Looks up a booking by its management token (included in confirmation emails for self-service actions). */
  async getBookingByToken(token: string) {
    const appt = await this.prisma.appointments.findUnique({
      where: { management_token: token },
      include: {
        services: true,
        profiles: {
          select: {
            id: true,
            full_name: true,
            business_name: true,
            avatar_url: true,
            booking_url_slug: true,
          },
        },
      },
    });
    if (!appt) throw new NotFoundException('Booking not found');
    return appt;
  }

  /** Cancels a booking via management token (client self-service, no auth required). */
  async cancelBooking(token: string) {
    const appt = await this.prisma.appointments.findUnique({
      where: { management_token: token },
      include: {
        services: true,
        profiles: { select: { email: true, full_name: true, business_name: true } },
      },
    });
    if (!appt) throw new NotFoundException('Booking not found');
    if (appt.status === 'cancelled') throw new BadRequestException('Already cancelled');

    await this.prisma.appointments.update({
      where: { id: appt.id },
      data: { status: 'cancelled', cancelled_by: 'client', updated_at: new Date() },
    });

    const profile = appt.profiles as any;
    const date = appt.start_time.toISOString().substring(0, 10);
    const time = appt.start_time.toISOString().substring(11, 16);
    this.email
      .sendCancellationNotificationToDoctor({
        to: profile.email,
        doctorName: profile.full_name ?? profile.business_name ?? 'Γιατρέ',
        clientName: appt.client_name,
        serviceName: appt.services.name,
        date,
        time,
      })
      .catch(() => null);

    return { message: 'Booking cancelled' };
  }

  /** Reschedules a booking via management token. Checks for conflicts at the new slot before saving. */
  async rescheduleBooking(token: string, dto: RescheduleBookingDto) {
    const appt = await this.prisma.appointments.findUnique({
      where: { management_token: token },
      include: { services: true },
    });
    if (!appt) throw new NotFoundException('Booking not found');
    if (appt.status === 'cancelled') throw new BadRequestException('Cannot reschedule a cancelled booking');

    const newStart = new Date(`${dto.date}T${dto.time}:00`);
    if (newStart < new Date()) throw new BadRequestException('Cannot reschedule to a slot in the past');
    const newEnd = addMinutes(newStart, appt.services.duration_minutes);

    await this.validateWithinWorkingHours(appt.profile_id, newStart, newEnd);

    await this.prisma.$transaction(
      async (tx) => {
        const conflict = await tx.appointments.findFirst({
          where: {
            profile_id: appt.profile_id,
            status: { in: ['pending', 'confirmed'] },
            id: { not: appt.id },
            AND: [{ start_time: { lt: newEnd } }, { end_time: { gt: newStart } }],
          },
        });
        if (conflict) throw new ConflictException('This time slot is not available');

        await tx.appointments.update({
          where: { id: appt.id },
          data: { start_time: newStart, end_time: newEnd, updated_at: new Date() },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    return { message: 'Booking rescheduled' };
  }

  /**
   * Finds up to 3 available dates before and after a base date (within ±20 days).
   * Used by the booking wizard to surface smart date suggestions when a day has no slots.
   * Fetches all data once and runs slot computation in-memory to avoid N+1 queries.
   */
  async findNearestDates(profileId: string, baseDateStr: string, durationMinutes: number) {
    const baseDate = this.parseDate(baseDateStr);
    const MAX = 20;
    const REQUIRED = 5;
    const searchStart = subHours(startOfDay(addDays(baseDate, -MAX)), 12);
    const searchEnd = addHours(endOfDay(addDays(baseDate, MAX)), 12);

    const [workingHours, blockedTimes, appointments, profile] = await Promise.all([
      this.prisma.working_hours.findMany({ where: { profile_id: profileId, is_enabled: true } }),
      this.prisma.blocked_time.findMany({
        where: { profile_id: profileId, date: { gte: searchStart, lte: searchEnd } },
      }),
      this.prisma.appointments.findMany({
        where: {
          profile_id: profileId,
          status: { not: 'cancelled' },
          start_time: { gte: searchStart, lt: searchEnd },
        },
        select: { start_time: true, end_time: true },
      }),
      this.prisma.user.findUnique({ where: { id: profileId }, select: { timezone: true, buffer_minutes: true } }),
    ]);

    const timezone = profile?.timezone ?? 'UTC';
    const bufferMinutes = profile?.buffer_minutes ?? 0;
    const today = startOfDay(toZonedTime(new Date(), timezone));

    const getSlotsForDate = (d: Date): string[] => {
      const wh = workingHours.find((w) => w.day_of_week === d.getDay());
      if (!wh) return [];
      return this.computeSlots(d, wh, blockedTimes, appointments, durationMinutes, format(d, 'yyyy-MM-dd'), timezone, bufferMinutes);
    };

    const nextDates: string[] = [];
    const prevDates: string[] = [];
    const slots: Record<string, string[]> = {};
    let offset = 1;

    while (nextDates.length < REQUIRED && offset <= MAX) {
      const d = addDays(baseDate, offset++);
      const s = getSlotsForDate(d);
      if (s.length > 0) {
        const key = format(d, 'yyyy-MM-dd');
        nextDates.push(key);
        slots[key] = s;
      }
    }
    offset = 1;
    while (prevDates.length < REQUIRED && offset <= MAX) {
      const d = addDays(baseDate, -offset++);
      if (d < today) break;
      const s = getSlotsForDate(d);
      if (s.length > 0) {
        const key = format(d, 'yyyy-MM-dd');
        prevDates.push(key);
        slots[key] = s;
      }
    }

    return { nextDates, prevDates: prevDates.sort(), slots };
  }

  /**
   * Core slot computation: generates every 30-minute slot within working hours,
   * skips slots that overlap with booked appointments or blocked times,
   * and skips past slots when the requested date is today (Athens timezone).
   */
  private computeSlots(
    date: Date,
    wh: any,
    blockedTimes: any[],
    appointments: any[],
    duration: number,
    dateStr: string,
    timezone: string = 'UTC',
    bufferMinutes: number = 0,
  ): string[] {
    const [startH, startM] = wh.start_time.toISOString().substring(11, 16).split(':').map(Number);
    const [endH, endM] = wh.end_time.toISOString().substring(11, 16).split(':').map(Number);

    let current = new Date(date);
    current.setHours(startH, startM, 0, 0);

    const athensNow = toZonedTime(new Date(), timezone);
    if (dateStr === format(athensNow, 'yyyy-MM-dd')) {
      const nowOnDate = new Date(date);
      nowOnDate.setHours(athensNow.getHours(), athensNow.getMinutes(), 0, 0);
      if (nowOnDate > current) {
        const skip = (30 - (nowOnDate.getMinutes() % 30)) % 30;
        current = addMinutes(nowOnDate, skip);
        current.setSeconds(0, 0);
      }
    }

    const closing = new Date(date);
    closing.setHours(endH, endM, 0, 0);

    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);

    const busy = [
      ...blockedTimes
        .filter((b) => b.date >= subHours(dayStart, 12) && b.date <= addHours(dayEnd, 12))
        .map((b) => {
          const s = new Date(date); s.setHours(b.start_time.getUTCHours(), b.start_time.getUTCMinutes(), 0, 0);
          const e = new Date(date); e.setHours(b.end_time.getUTCHours(), b.end_time.getUTCMinutes(), 0, 0);
          return { start: s.getTime(), end: e.getTime() };
        }),
      ...appointments
        .filter((a) => a.start_time < dayEnd && a.end_time > dayStart)
        .map((a) => ({ start: a.start_time.getTime(), end: a.end_time.getTime() + bufferMinutes * 60_000 })),
    ];

    const slots: string[] = [];
    while (current < closing) {
      const slotEnd = addMinutes(current, duration);
      if (slotEnd > closing) break;
      const s = current.getTime(), e = slotEnd.getTime();
      if (!busy.some((b) => s < b.end - 1000 && e - 1000 > b.start)) {
        slots.push(format(current, 'HH:mm'));
      }
      current = addMinutes(current, 30);
    }
    return slots;
  }

  /** Throws if startTime–endTime falls outside the doctor's working hours for that day. */
  private async validateWithinWorkingHours(profileId: string, startTime: Date, endTime: Date): Promise<void> {
    const wh = await this.prisma.working_hours.findFirst({
      where: { profile_id: profileId, day_of_week: startTime.getDay(), is_enabled: true },
    });
    if (!wh) throw new BadRequestException('Doctor does not work on this day');

    const [openH, openM] = wh.start_time.toISOString().substring(11, 16).split(':').map(Number);
    const [closeH, closeM] = wh.end_time.toISOString().substring(11, 16).split(':').map(Number);

    const open = new Date(startTime); open.setHours(openH, openM, 0, 0);
    const close = new Date(startTime); close.setHours(closeH, closeM, 0, 0);

    if (startTime < open || endTime > close) {
      throw new BadRequestException('Requested time is outside working hours');
    }
  }

  /**
   * Returns the next `limit` available slots for a doctor, using their shortest service duration.
   */
  async getNextSlots(slug: string, limit: number = 3): Promise<{ date: string; time: string }[]> {
    const profileId = await this.resolveProfileId(slug);

    const [shortestService] = await this.prisma.services.findMany({
      where: { profile_id: profileId, is_active: true },
      select: { duration_minutes: true },
      orderBy: { duration_minutes: 'asc' },
      take: 1,
    });
    const duration = shortestService?.duration_minutes ?? 30;

    const baseDateStr = format(new Date(), 'yyyy-MM-dd');
    const { nextDates, slots } = await this.findNearestDates(profileId, baseDateStr, duration);

    const result: { date: string; time: string }[] = [];
    for (const date of nextDates) {
      for (const time of (slots[date] ?? [])) {
        result.push({ date, time });
        if (result.length >= limit) return result;
      }
    }
    return result;
  }

  /**
   * Returns the next `limit` available dates with the first available slot of each day.
   * Used by the search results page to show the doctolib-style date grid.
   */
  async getAvailabilityDates(slug: string, limit: number = 6): Promise<{ date: string; firstSlot: string }[]> {
    const cacheKey = `${slug}:${limit}`
    const cached = availCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.data

    const profileId = await this.resolveProfileId(slug);

    const [shortestService] = await this.prisma.services.findMany({
      where: { profile_id: profileId, is_active: true },
      select: { duration_minutes: true },
      orderBy: { duration_minutes: 'asc' },
      take: 1,
    });
    const duration = shortestService?.duration_minutes ?? 30;

    const baseDateStr = format(new Date(), 'yyyy-MM-dd');
    const { nextDates, slots } = await this.findNearestDates(profileId, baseDateStr, duration);

    const result = nextDates
      .slice(0, limit)
      .map((date) => ({ date, firstSlot: slots[date]?.[0] ?? '' }))
      .filter((d) => d.firstSlot !== '');

    availCache.set(cacheKey, { data: result, expiresAt: Date.now() + AVAIL_TTL });
    return result;
  }

  /** Resolves a booking slug to a profile id without fetching the full profile. */
  async resolveProfileId(slug: string): Promise<string> {
    const profile = await this.prisma.user.findUnique({
      where: { booking_url_slug: slug },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Profile not found');
    return profile.id;
  }

  /** Parses a YYYY-MM-DD string as a local Date without timezone offset issues. */
  private parseDate(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
}
