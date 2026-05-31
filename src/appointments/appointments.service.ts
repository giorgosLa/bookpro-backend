import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { UpdateStatusDto } from './dto/update-status.dto';
import { CalendarSyncService } from '@/calendar/calendar-sync.service';

@Injectable()
export class AppointmentsService {
  constructor(
    private prisma: PrismaService,
    private calendarSync: CalendarSyncService,
  ) {}

  /** Returns all appointments for a doctor, sorted newest first, with their service details. */
  async findAll(userId: string) {
    return this.prisma.appointments.findMany({
      where: { profile_id: userId },
      include: { services: true },
      orderBy: { start_time: 'desc' },
    });
  }

  /**
   * Updates the status of an appointment (e.g. confirmed, cancelled, completed).
   * Verifies that the appointment belongs to the requesting user.
   * Fires a Google Calendar sync after status change (errors are swallowed).
   */
  async updateStatus(userId: string, appointmentId: string, dto: UpdateStatusDto) {
    const appt = await this.prisma.appointments.findUnique({
      where: { id: appointmentId },
      include: { services: true },
    });
    if (!appt) throw new NotFoundException('Appointment not found');
    if (appt.profile_id !== userId) throw new ForbiddenException();

    const updated = await this.prisma.appointments.update({
      where: { id: appointmentId },
      data: { status: dto.status, updated_at: new Date() },
      include: { services: true },
    });

    this.syncWithGoogle(userId, updated).catch(() => null);

    return updated;
  }

  /**
   * Manually triggers a Google Calendar sync for a specific appointment.
   * Used when automatic sync failed or when the doctor enables Calendar after booking.
   */
  async syncToGoogle(userId: string, appointmentId: string) {
    const appt = await this.prisma.appointments.findUnique({
      where: { id: appointmentId },
      include: { services: true },
    });
    if (!appt) throw new NotFoundException('Appointment not found');
    if (appt.profile_id !== userId) throw new ForbiddenException();
    await this.syncWithGoogle(userId, appt);
    return { message: 'Synced with Google Calendar' };
  }

  /** Skips silently if the doctor has not enabled Google Calendar integration. */
  private async syncWithGoogle(userId: string, appt: any) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.google_calendar_enabled) return;
    await this.calendarSync.syncAppointment(userId, appt);
  }
}
