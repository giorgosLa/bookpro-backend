import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { UpdateStatusDto } from './dto/update-status.dto';
import { subDays } from 'date-fns';

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

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

  async updateStatus(userId: string, appointmentId: string, dto: UpdateStatusDto) {
    const appt = await this.prisma.appointments.findUnique({
      where: { id: appointmentId },
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

    if (dto.status === 'cancelled') {
      setTimeout(() => {
        this.prisma.appointments
          .delete({ where: { id: appointmentId } })
          .catch(() => null);
      }, 2000);
    }

    return updated;
  }
}
