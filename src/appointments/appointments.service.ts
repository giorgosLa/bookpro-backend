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

    const [upcoming, past] = await Promise.all([
      this.prisma.appointments.findMany({
        where: { profile_id: userId, start_time: { gte: now } },
        include: { services: true },
        orderBy: { start_time: 'asc' },
      }),
      this.prisma.appointments.findMany({
        where: { profile_id: userId, start_time: { lt: now, gte: ninetyDaysAgo } },
        include: { services: true },
        orderBy: { start_time: 'desc' },
      }),
    ]);

    return [...upcoming, ...past];
  }

  async findMyAppointments(patientId: string) {
    const now = new Date();
    const ninetyDaysAgo = subDays(now, 90);

    const [upcoming, past] = await Promise.all([
      this.prisma.appointments.findMany({
        where: { patient_id: patientId, start_time: { gte: now } },
        include: {
          services: true,
          profiles: {
            select: { id: true, full_name: true, business_name: true, avatar_url: true, booking_url_slug: true },
          },
        },
        orderBy: { start_time: 'asc' },
      }),
      this.prisma.appointments.findMany({
        where: { patient_id: patientId, start_time: { lt: now, gte: ninetyDaysAgo } },
        include: {
          services: true,
          profiles: {
            select: { id: true, full_name: true, business_name: true, avatar_url: true, booking_url_slug: true },
          },
        },
        orderBy: { start_time: 'desc' },
      }),
    ]);

    return { upcoming, past };
  }

  async updateStatus(userId: string, appointmentId: string, dto: UpdateStatusDto) {
    const appt = await this.prisma.appointments.findUnique({
      where: { id: appointmentId },
      include: { services: true, profiles: true },
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

    if (dto.status === AppointmentStatus.CONFIRMED) {
      const appUrl = this.config.get<string>('appUrl') ?? 'http://localhost:3000';
      this.email.sendAppointmentConfirmedToPatient({
        to: appt.client_email,
        clientName: appt.client_name,
        businessName: appt.profiles.business_name ?? appt.profiles.full_name ?? 'Ο γιατρός σας',
        serviceName: appt.services.name,
        date: format(appt.start_time, 'dd/MM/yyyy'),
        time: format(appt.start_time, 'HH:mm'),
        managementToken: appt.management_token,
        appUrl,
      });
    }

    return updated;
  }
}
