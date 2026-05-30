import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { EmailService } from '@/email/email.service';
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

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private config: ConfigService,
  ) {}

  async getProfile(slug: string) {
    const profile = await this.prisma.user.findUnique({
      where: { booking_url_slug: slug },
      include: {
        services: { where: { is_active: true } },
        working_hours: true,
      },
    });
    if (!profile) throw new NotFoundException('Profile not found');
    const { password, ...safe } = profile as any;
    return safe;
  }

  async getSlots(profileId: string, dateStr: string, durationMinutes: number, excludeId?: string) {
    const selectedDate = this.parseDate(dateStr);
    const dayOfWeek = selectedDate.getDay();

    const wh = await this.prisma.working_hours.findFirst({
      where: { profile_id: profileId, day_of_week: dayOfWeek, is_enabled: true },
    });
    if (!wh) return [];

    const dayStart = startOfDay(selectedDate);
    const dayEnd = endOfDay(selectedDate);

    const [blockedTimes, appointments] = await Promise.all([
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
    ]);

    return this.computeSlots(selectedDate, wh, blockedTimes, appointments, durationMinutes, dateStr);
  }

  async createBooking(dto: CreateBookingDto) {
    const service = await this.prisma.services.findUnique({ where: { id: dto.serviceId } });
    if (!service) throw new BadRequestException('Service not found');

    const startTime = new Date(`${dto.date}T${dto.time}:00`);
    const endTime = addMinutes(startTime, service.duration_minutes);

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

  async getBookingByToken(token: string) {
    const appt = await this.prisma.appointments.findFirst({
      where: { management_token: token },
      include: { services: true, profiles: true },
    });
    if (!appt) throw new NotFoundException('Booking not found');
    return appt;
  }

  async cancelBooking(token: string) {
    const appt = await this.prisma.appointments.findFirst({ where: { management_token: token } });
    if (!appt) throw new NotFoundException('Booking not found');
    if (appt.status === 'cancelled') throw new BadRequestException('Already cancelled');

    await this.prisma.appointments.update({
      where: { id: appt.id },
      data: { status: 'cancelled', updated_at: new Date() },
    });
    return { message: 'Booking cancelled' };
  }

  async rescheduleBooking(token: string, dto: RescheduleBookingDto) {
    const appt = await this.prisma.appointments.findFirst({
      where: { management_token: token },
      include: { services: true },
    });
    if (!appt) throw new NotFoundException('Booking not found');
    if (appt.status === 'cancelled') throw new BadRequestException('Cannot reschedule a cancelled booking');

    const newStart = new Date(`${dto.date}T${dto.time}:00`);
    const newEnd = addMinutes(newStart, appt.services.duration_minutes);

    const conflict = await this.prisma.appointments.findFirst({
      where: {
        profile_id: appt.profile_id,
        status: { in: ['pending', 'confirmed'] },
        id: { not: appt.id },
        AND: [{ start_time: { lt: newEnd } }, { end_time: { gt: newStart } }],
      },
    });
    if (conflict) throw new ConflictException('This time slot is not available');

    await this.prisma.appointments.update({
      where: { id: appt.id },
      data: { start_time: newStart, end_time: newEnd, updated_at: new Date() },
    });
    return { message: 'Booking rescheduled' };
  }

  async findNearestDates(profileId: string, baseDateStr: string, durationMinutes: number) {
    const baseDate = this.parseDate(baseDateStr);
    const MAX = 20;
    const REQUIRED = 3;
    const today = startOfDay(toZonedTime(new Date(), 'Europe/Athens'));

    const searchStart = subHours(startOfDay(addDays(baseDate, -MAX)), 12);
    const searchEnd = addHours(endOfDay(addDays(baseDate, MAX)), 12);

    const [workingHours, blockedTimes, appointments] = await Promise.all([
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
    ]);

    const hasSlots = (d: Date) => {
      const wh = workingHours.find((w) => w.day_of_week === d.getDay());
      if (!wh) return false;
      const slots = this.computeSlots(d, wh, blockedTimes, appointments, durationMinutes, format(d, 'yyyy-MM-dd'));
      return slots.length > 0;
    };

    const nextDates: string[] = [];
    const prevDates: string[] = [];
    let offset = 1;

    while (nextDates.length < REQUIRED && offset <= MAX) {
      const d = addDays(baseDate, offset++);
      if (hasSlots(d)) nextDates.push(format(d, 'yyyy-MM-dd'));
    }
    offset = 1;
    while (prevDates.length < REQUIRED && offset <= MAX) {
      const d = addDays(baseDate, -offset++);
      if (d < today) break;
      if (hasSlots(d)) prevDates.push(format(d, 'yyyy-MM-dd'));
    }

    return { nextDates, prevDates: prevDates.sort() };
  }

  private computeSlots(
    date: Date,
    wh: any,
    blockedTimes: any[],
    appointments: any[],
    duration: number,
    dateStr: string,
  ): string[] {
    const [startH, startM] = wh.start_time.toISOString().substr(11, 5).split(':').map(Number);
    const [endH, endM] = wh.end_time.toISOString().substr(11, 5).split(':').map(Number);

    let current = new Date(date);
    current.setHours(startH, startM, 0, 0);

    const athensNow = toZonedTime(new Date(), 'Europe/Athens');
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
        .map((a) => ({ start: a.start_time.getTime(), end: a.end_time.getTime() })),
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

  private parseDate(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
}
