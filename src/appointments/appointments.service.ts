import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { EmailService } from '@/email/email.service';
import { ConfigService } from '@nestjs/config';
import { GoogleCalendarService } from '@/calendar/google-calendar.service';
import { UpdateStatusDto, AppointmentStatus } from './dto/update-status.dto';
import { subDays, format } from 'date-fns';

@Injectable()
export class AppointmentsService {
  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private config: ConfigService,
    private googleCalendar: GoogleCalendarService,
  ) {}

  async findAll(userId: string) {
    const now = new Date();
    const ninetyDaysAgo = subDays(now, 90);

    const doctorInclude = {
      appointment_services: { include: { service: { include: { service_category: true } } } },
      location: { select: { name: true } },
    };

    const [upcoming, past] = await Promise.all([
      (this.prisma.appointments as any).findMany({
        where: { profile_id: userId, start_time: { gte: now } },
        include: doctorInclude,
        orderBy: { start_time: 'asc' },
      }),
      (this.prisma.appointments as any).findMany({
        where: { profile_id: userId, start_time: { lt: now, gte: ninetyDaysAgo } },
        include: doctorInclude,
        orderBy: { start_time: 'desc' },
      }),
    ]);

    return [...upcoming, ...past];
  }

  async findMyAppointments(patientId: string) {
    const now = new Date();
    const ninetyDaysAgo = subDays(now, 90);

    const patientSelect = {
      appointment_services: { include: { service: true } },
      profiles: {
        select: { id: true, full_name: true, business_name: true, avatar_url: true, booking_url_slug: true },
      },
    };

    const [upcoming, pastRaw] = await Promise.all([
      (this.prisma.appointments as any).findMany({
        where: { patient_id: patientId, start_time: { gte: now }, status: { not: 'cancelled' } },
        include: patientSelect,
        orderBy: { start_time: 'asc' },
      }),
      (this.prisma.appointments as any).findMany({
        where: { patient_id: patientId, start_time: { lt: now, gte: ninetyDaysAgo } },
        include: patientSelect,
        orderBy: { start_time: 'desc' },
      }),
    ]);

    return {
      upcoming,
      completed: pastRaw.filter((a: any) => a.status === 'completed'),
      cancelled: pastRaw.filter((a: any) => a.status === 'cancelled'),
    };
  }

  async updateStatus(userId: string, appointmentId: string, dto: UpdateStatusDto) {
    const appt = await (this.prisma.appointments as any).findUnique({
      where: { id: appointmentId },
      include: {
        appointment_services: { include: { service: true } },
        profiles: true,
        location: { select: { name: true, address: true, lat: true, lng: true } },
      },
    });
    if (!appt) throw new NotFoundException('Appointment not found');
    if (appt.profile_id !== userId) throw new ForbiddenException();

    const updated = await (this.prisma.appointments as any).update({
      where: { id: appointmentId },
      data: {
        status: dto.status,
        cancelled_by: dto.status === 'cancelled' ? 'doctor' : null,
        updated_at: new Date(),
      },
      include: { appointment_services: { include: { service: true } } },
    });

    const appUrl = this.config.get<string>('appUrl') ?? 'http://localhost:3000';
    const businessName = appt.profiles.business_name ?? appt.profiles.full_name ?? 'Ο γιατρός σας';
    const serviceNames = (appt.appointment_services as any[]).map((as: any) => as.service.name).join(', ');

    if (dto.status === AppointmentStatus.CONFIRMED) {
      const loc = (appt as any).location as { name: string; address: string | null; lat: number | null; lng: number | null } | null;
      let mapsUrl: string | undefined;
      if (loc) {
        mapsUrl = loc.lat && loc.lng
          ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}`
          : loc.address
            ? `https://maps.google.com/?q=${encodeURIComponent(loc.address)}`
            : undefined;
      }
      this.email.sendAppointmentConfirmedToPatient({
        to: appt.client_email,
        clientName: appt.client_name,
        businessName,
        serviceName: serviceNames,
        date: format(appt.start_time, 'dd/MM/yyyy'),
        time: format(appt.start_time, 'HH:mm'),
        managementToken: appt.management_token,
        appUrl,
        refNumber: appt.ref_number,
        locationName: loc?.name ?? undefined,
        locationAddress: loc?.address ?? undefined,
        mapsUrl,
      }).catch(() => null);
    }

    if (dto.status === AppointmentStatus.CANCELLED) {
      // Remove the mirrored Google Calendar event (fire-and-forget).
      if ((appt as any).google_event_id) {
        void this.googleCalendar
          .deleteEvent(appt.profile_id, (appt as any).google_event_id)
          .catch(() => null);
      }

      this.email.sendCancellationNotificationToPatient({
        to: appt.client_email,
        clientName: appt.client_name,
        businessName,
        serviceName: serviceNames,
        date: format(appt.start_time, 'dd/MM/yyyy'),
        time: format(appt.start_time, 'HH:mm'),
        refNumber: appt.ref_number,
      }).catch(() => null);
    }

    return updated;
  }
}
