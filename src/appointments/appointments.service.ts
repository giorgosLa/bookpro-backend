import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { EmailService } from '@/email/email.service';
import { ConfigService } from '@nestjs/config';
import { UpdateStatusDto, AppointmentStatus } from './dto/update-status.dto';
import { subDays, format } from 'date-fns';

@Injectable()
export class AppointmentsService {
  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private config: ConfigService,
  ) {}

  async findAll(userId: string) {
    const now = new Date();
    const ninetyDaysAgo = subDays(now, 90);

    const doctorInclude = {
      services: { include: { service_category: true } },
      location: { select: { name: true } },
    } as const;

    const [upcoming, past] = await Promise.all([
      this.prisma.appointments.findMany({
        where: { profile_id: userId, start_time: { gte: now } },
        include: doctorInclude,
        orderBy: { start_time: 'asc' },
      }),
      this.prisma.appointments.findMany({
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
      services: true,
      profiles: {
        select: { id: true, full_name: true, business_name: true, avatar_url: true, booking_url_slug: true },
      },
    } as const;

    const [upcoming, pastRaw] = await Promise.all([
      this.prisma.appointments.findMany({
        where: { patient_id: patientId, start_time: { gte: now }, status: { not: 'cancelled' } },
        include: patientSelect,
        orderBy: { start_time: 'asc' },
      }),
      this.prisma.appointments.findMany({
        where: { patient_id: patientId, start_time: { lt: now, gte: ninetyDaysAgo } },
        include: patientSelect,
        orderBy: { start_time: 'desc' },
      }),
    ]);

    return {
      upcoming,
      completed: pastRaw.filter((a) => a.status === 'completed'),
      cancelled: pastRaw.filter((a) => a.status === 'cancelled'),
    };
  }

  async updateStatus(userId: string, appointmentId: string, dto: UpdateStatusDto) {
    const appt = await this.prisma.appointments.findUnique({
      where: { id: appointmentId },
      include: {
        services: true,
        profiles: true,
        location: { select: { name: true, address: true, lat: true, lng: true } },
      },
    });
    if (!appt) throw new NotFoundException('Appointment not found');
    if (appt.profile_id !== userId) throw new ForbiddenException();

    const updated = await this.prisma.appointments.update({
      where: { id: appointmentId },
      data: {
        status: dto.status,
        cancelled_by: dto.status === 'cancelled' ? 'doctor' : null,
        updated_at: new Date(),
      },
      include: { services: true },
    });

    const appUrl = this.config.get<string>('appUrl') ?? 'http://localhost:3000';
    const businessName = appt.profiles.business_name ?? appt.profiles.full_name ?? 'Ο γιατρός σας';

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
        serviceName: appt.services.name,
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
      this.email.sendCancellationNotificationToPatient({
        to: appt.client_email,
        clientName: appt.client_name,
        businessName,
        serviceName: appt.services.name,
        date: format(appt.start_time, 'dd/MM/yyyy'),
        time: format(appt.start_time, 'HH:mm'),
        refNumber: appt.ref_number,
      }).catch(() => null);
    }

    return updated;
  }
}
