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
import { randomBytes } from 'crypto';

function generateRefCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(6), (b) => chars[b % chars.length]).join('');
}

export const availCache = new Map<string, { data: { date: string; firstSlot: string }[]; expiresAt: number }>()
const AVAIL_TTL = 30 * 1000 // 30 seconds

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private config: ConfigService,
    private events: EventsService,
  ) {}

  private static readonly SPECIALTY_LABELS: Record<string, string> = {
    GENERAL_PRACTITIONER: 'Παθολόγος', CARDIOLOGIST: 'Καρδιολόγος', DERMATOLOGIST: 'Δερματολόγος',
    ENDOCRINOLOGIST: 'Ενδοκρινολόγος', GASTROENTEROLOGIST: 'Γαστρεντερολόγος', NEUROLOGIST: 'Νευρολόγος',
    OBSTETRICIAN_GYNECOLOGIST: 'Γυναικολόγος', OPHTHALMOLOGIST: 'Οφθαλμίατρος', ORTHOPEDIC_SURGEON: 'Ορθοπεδικός',
    OTOLARYNGOLOGIST: 'Ωτορινολαρυγγολόγος', PEDIATRICIAN: 'Παιδίατρος', PSYCHIATRIST: 'Ψυχίατρος',
    PULMONOLOGIST: 'Πνευμονολόγος', RADIOLOGIST: 'Ακτινολόγος', RHEUMATOLOGIST: 'Ρευματολόγος',
    SURGEON: 'Χειρουργός', UROLOGIST: 'Ουρολόγος', DENTIST: 'Οδοντίατρος', ORTHODONTIST: 'Ορθοδοντικός',
    PHYSIOTHERAPIST: 'Φυσιοθεραπευτής', PSYCHOLOGIST: 'Ψυχολόγος', NUTRITIONIST: 'Διαιτολόγος', OTHER: 'Άλλο',
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
        role: 'DOCTOR',
        booking_url_slug: { not: null },
        is_suspended: false,
        doctor_profile: { verification_status: 'APPROVED' },
        OR: [
          { full_name: { contains: q.trim(), mode: 'insensitive' } },
          { business_name: { contains: q.trim(), mode: 'insensitive' } },
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
        name: d.business_name ?? d.full_name ?? '',
        slug: d.booking_url_slug,
        avatar: d.avatar_url,
        specialty: d.doctor_profile?.specialty
          ? (PublicService.SPECIALTY_LABELS[d.doctor_profile.specialty] ?? '')
          : '',
      })),
    };
  }

  /** Returns all registered doctors who have a booking slug. Optionally filters by specialty enum. */
  async getDoctors(specialty?: string, location?: string) {
    const validSpecialty = specialty && Object.values(MedicalSpecialty).includes(specialty as MedicalSpecialty)
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
      locationIds = rows.map(r => r.id);
      if (locationIds.length === 0) return [];
    }

    const doctors = await this.prisma.user.findMany({
      where: {
        role: 'DOCTOR',
        booking_url_slug: { not: null },
        is_suspended: false,
        doctor_profile: {
          verification_status: 'APPROVED',
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
          orderBy: { duration_minutes: 'asc' },
          take: 3,
        },
        locations: {
          where: { is_active: true },
          select: { id: true, name: true, address: true },
          orderBy: [{ order: 'asc' }, { created_at: 'asc' }],
          take: 5,
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
        is_suspended: true,
        doctor_profile: {
          select: { specialty: true, latitude: true, longitude: true, accepts_gessy: true, accepts_eopyy: true, verification_status: true, medical_association_number: true, gender: true },
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
        doctor_photos: {
          orderBy: { order: 'asc' as const },
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
          orderBy: [{ order: 'asc' }, { created_at: 'asc' }],
        },
      },
    });
    if (!profile || profile.is_suspended || profile.doctor_profile?.verification_status !== 'APPROVED') {
      throw new NotFoundException('Profile not found');
    }
    return profile;
  }

  /**
   * Returns available HH:mm time slots for a given date and service duration.
   * Returns [] if the doctor doesn't work on that day.
   * excludeId skips an existing appointment (used during reschedule).
   */
  async getSlots(profileId: string, dateStr: string, durationMinutes: number, excludeId?: string, locationId?: string) {
    const selectedDate = this.parseDate(dateStr);
    const dayOfWeek = selectedDate.getDay();

    // Try location-specific hours first; fall back to global (location_id: null)
    let wh = await this.prisma.working_hours.findFirst({
      where: { profile_id: profileId, day_of_week: dayOfWeek, is_enabled: true, location_id: locationId ?? null },
    });
    if (!wh && locationId) {
      wh = await this.prisma.working_hours.findFirst({
        where: { profile_id: profileId, day_of_week: dayOfWeek, is_enabled: true, location_id: null },
      });
    }
    if (!wh) return [];

    const dayStart = startOfDay(selectedDate);
    const dayEnd = endOfDay(selectedDate);

    const [blockedTimes, appointments, profile] = await Promise.all([
      this.prisma.blocked_time.findMany({
        where: {
          profile_id: profileId,
          date: { gte: subHours(dayStart, 12), lte: addHours(dayEnd, 12) },
          OR: [{ location_id: null }, ...(locationId ? [{ location_id: locationId }] : [])],
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
   * Accepts one or more serviceIds; total duration is the sum of all service durations.
   * Sends a confirmation email asynchronously (failure is swallowed — doesn't affect the response).
   */
  async createBooking(dto: CreateBookingDto, patientId?: string) {
    const doctor = await this.prisma.user.findUnique({
      where: { id: dto.profileId },
      select: { is_suspended: true, doctor_profile: { select: { verification_status: true } } },
    });
    if (!doctor || doctor.is_suspended || doctor.doctor_profile?.verification_status !== 'APPROVED') {
      throw new BadRequestException('Doctor is not available for booking');
    }

    const services = await this.prisma.services.findMany({
      where: { id: { in: dto.serviceIds }, profile_id: dto.profileId },
    });
    if (services.length !== dto.serviceIds.length) throw new BadRequestException('One or more services not found');

    const totalDuration = services.reduce((sum, s) => sum + s.duration_minutes, 0);
    const startTime = new Date(`${dto.date}T${dto.time}:00`);
    if (startTime < new Date()) throw new BadRequestException('Cannot book a slot in the past');
    const endTime = addMinutes(startTime, totalDuration);

    await this.validateWithinWorkingHours(dto.profileId, startTime, endTime, dto.locationId);

    const createAppointment = async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await this.prisma.$transaction(
            async (tx) => {
              const conflict = await tx.appointments.findFirst({
                where: {
                  profile_id: dto.profileId,
                  status: { in: ['pending', 'confirmed'] },
                  AND: [{ start_time: { lt: endTime } }, { end_time: { gt: startTime } }],
                },
              });
              if (conflict) throw new ConflictException('This time slot is no longer available');

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
                  status: 'pending',
                  management_token: uuidv4(),
                  notes: dto.notes ?? null,
                  appointment_services: {
                    create: dto.serviceIds.map((serviceId) => ({ id: uuidv4(), service_id: serviceId })),
                  },
                },
                include: { profiles: true, appointment_services: { include: { service: true } } },
              });
            },
            { isolationLevel: 'Serializable' },
          );
        } catch (err: any) {
          const isRefNumberCollision =
            err?.code === 'P2002' &&
            (err?.meta?.target?.includes('ref_number') ||
              err?.meta?.driverAdapterError?.cause?.constraint?.fields?.includes('ref_number'));
          if (isRefNumberCollision) {
            console.warn(`[ref_number] collision on attempt ${attempt + 1}, retrying...`);
            if (attempt < 4) continue;
            throw new BadRequestException('Could not generate unique booking reference, please try again');
          }
          throw err;
        }
      }
    };

    const [appointment, location] = await Promise.all([
      createAppointment(),
      dto.locationId
        ? this.prisma.locations.findUnique({
            where: { id: dto.locationId },
            select: { name: true, address: true, lat: true, lng: true },
          })
        : Promise.resolve(null),
    ]);

    const serviceNames = services.map((s) => s.name).join(', ');
    const doctor_profile = (appointment as any).profiles as any;

    // Push real-time notification to the doctor's SSE stream (fire-and-forget)
    this.events.emit(appointment.profile_id, {
      type: 'new_appointment',
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

    const appUrl = this.config.get<string>('appUrl') ?? 'http://localhost:3000';

    let mapsUrl: string | undefined;
    if (location) {
      mapsUrl = location.lat && location.lng
        ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
        : location.address
          ? `https://maps.google.com/?q=${encodeURIComponent(location.address)}`
          : undefined;
    }

    this.email
      .sendBookingConfirmation({
        to: dto.clientEmail,
        clientName: dto.clientName,
        businessName: doctor_profile?.business_name ?? doctor_profile?.full_name ?? 'BookPro',
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
        doctorName: doctor_profile?.full_name ?? doctor_profile?.business_name ?? 'Γιατρέ',
        clientName: dto.clientName,
        clientPhone: dto.clientPhone ?? null,
        serviceName: serviceNames,
        date: format(startTime, 'dd/MM/yyyy'),
        time: format(startTime, 'HH:mm'),
        notes: dto.notes ?? null,
        appUrl,
        refNumber: appointment.ref_number,
      })
      .catch(() => null);

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
    if (!appt) throw new NotFoundException('Booking not found');
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
    if (!appt) throw new NotFoundException('Booking not found');
    if (appt.status === 'cancelled') throw new BadRequestException('Already cancelled');

    await this.prisma.appointments.update({
      where: { id: appt.id },
      data: { status: 'cancelled', cancelled_by: 'client', updated_at: new Date() },
    });

    this.events.emit(appt.profile_id, {
      type: 'appointment_cancelled',
      id: appt.id,
      status: 'cancelled',
      cancelled_by: 'client',
    });

    const profile = appt.profiles as any;
    const date = format(appt.start_time, 'dd/MM/yyyy');
    const time = format(appt.start_time, 'HH:mm');
    const businessName = profile.full_name ?? profile.business_name ?? 'Ο γιατρός σας';
    const serviceNames = (appt.appointment_services as any[]).map((as: any) => as.service.name).join(', ');

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

    const appUrl = this.config.get<string>('appUrl') ?? 'http://localhost:3000';
    const bookingUrl = profile.booking_url_slug
      ? `${appUrl}/book/${profile.booking_url_slug}`
      : undefined;

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

    return { message: 'Booking cancelled' };
  }

  /** Reschedules a booking via management token. Checks for conflicts at the new slot before saving. */
  async rescheduleBooking(token: string, dto: RescheduleBookingDto) {
    const appt = await (this.prisma.appointments as any).findUnique({
      where: { management_token: token },
      include: {
        appointment_services: { include: { service: true } },
        profiles: { select: { email: true, full_name: true, business_name: true, booking_url_slug: true } },
      },
    });
    if (!appt) throw new NotFoundException('Booking not found');
    if (appt.status === 'cancelled') throw new BadRequestException('Cannot reschedule a cancelled booking');

    const totalDuration = (appt.appointment_services as any[]).reduce(
      (sum: number, as: any) => sum + (as.service.duration_minutes ?? 30),
      0,
    );
    const newStart = new Date(`${dto.date}T${dto.time}:00`);
    if (newStart < new Date()) throw new BadRequestException('Cannot reschedule to a slot in the past');
    const newEnd = addMinutes(newStart, totalDuration || 30);

    await this.validateWithinWorkingHours(appt.profile_id, newStart, newEnd, appt.location_id ?? undefined);

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
          data: { start_time: newStart, end_time: newEnd, status: 'pending', updated_at: new Date() },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    this.events.emit(appt.profile_id, {
      type: 'appointment_rescheduled',
      id: appt.id,
      start_time: newStart,
      end_time: newEnd,
      status: 'pending',
    });

    const doctor = (appt as any).profiles as { email: string; full_name: string | null; business_name: string | null };
    const businessName = doctor.full_name ?? doctor.business_name ?? 'Ο γιατρός σας';
    const appUrl = this.config.get<string>('appUrl') ?? 'http://localhost:3000';
    const serviceNames = (appt.appointment_services as any[]).map((as: any) => as.service.name).join(', ');

    this.email
      .sendRescheduleNotificationToDoctor({
        to: doctor.email,
        doctorName: businessName,
        clientName: appt.client_name,
        serviceName: serviceNames,
        oldDate: format(appt.start_time, 'dd/MM/yyyy'),
        oldTime: format(appt.start_time, 'HH:mm'),
        newDate: format(newStart, 'dd/MM/yyyy'),
        newTime: format(newStart, 'HH:mm'),
        refNumber: appt.ref_number,
      })
      .catch(() => null);

    this.email
      .sendRescheduleConfirmationToPatient({
        to: appt.client_email,
        clientName: appt.client_name,
        businessName,
        serviceName: serviceNames,
        newDate: format(newStart, 'dd/MM/yyyy'),
        newTime: format(newStart, 'HH:mm'),
        managementToken: appt.management_token,
        appUrl,
        refNumber: appt.ref_number,
      })
      .catch(() => null);

    return { message: 'Booking rescheduled' };
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

    const [workingHours, blockedTimes, appointments, profile] = await Promise.all([
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
  private async validateWithinWorkingHours(profileId: string, startTime: Date, endTime: Date, locationId?: string): Promise<void> {
    // Try location-specific hours first; fall back to global (location_id: null)
    let wh = await this.prisma.working_hours.findFirst({
      where: { profile_id: profileId, day_of_week: startTime.getDay(), is_enabled: true, location_id: locationId ?? null },
    });
    if (!wh && locationId) {
      wh = await this.prisma.working_hours.findFirst({
        where: { profile_id: profileId, day_of_week: startTime.getDay(), is_enabled: true, location_id: null },
      });
    }
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
   * When locationId is provided, only shows availability for that specific location.
   */
  async getAvailabilityDates(slug: string, limit: number = 6, locationId?: string): Promise<{ date: string; firstSlot: string }[]> {
    const profileId = await this.resolveProfileId(slug);
    const cacheKey = `${profileId}:${limit}:${locationId ?? 'all'}`
    const cached = availCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.data

    const [shortestService] = await this.prisma.services.findMany({
      where: { profile_id: profileId, is_active: true },
      select: { duration_minutes: true },
      orderBy: { duration_minutes: 'asc' },
      take: 1,
    });
    const duration = shortestService?.duration_minutes ?? 30;

    const baseDateStr = format(new Date(), 'yyyy-MM-dd');
    const { nextDates, slots } = await this.findNearestDates(profileId, baseDateStr, duration, locationId);

    const result = nextDates
      .slice(0, limit)
      .map((date) => ({ date, firstSlot: slots[date]?.[0] ?? '' }))
      .filter((d) => d.firstSlot !== '');

    availCache.set(cacheKey, { data: result, expiresAt: Date.now() + AVAIL_TTL });
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
        doctor_profile: { verification_status: 'APPROVED' },
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
        orderBy: { duration_minutes: 'asc' },
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
          status: { not: 'cancelled' },
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
      const timezone = profile.timezone ?? 'UTC';
      const bufferMinutes = profile.buffer_minutes ?? 0;

      const dates: { date: string; firstSlot: string }[] = [];
      let offset = 1;

      while (dates.length < limit && offset <= MAX_DAYS) {
        const d = addDays(today, offset++);
        const wh = hours.find((h) => h.day_of_week === d.getDay());
        if (!wh) continue;
        const dateStr = format(d, 'yyyy-MM-dd');
        const slots = this.computeSlots(d, wh, blocked, appointments, duration, dateStr, timezone, bufferMinutes);
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
    if (!profile || profile.is_suspended || profile.doctor_profile?.verification_status !== 'APPROVED') {
      throw new NotFoundException('Profile not found');
    }
    return profile.id;
  }

  /** Parses a YYYY-MM-DD string as a local Date without timezone offset issues. */
  private parseDate(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

}
