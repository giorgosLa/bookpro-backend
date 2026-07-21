import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { CreateBlockedTimeDto } from './dto/blocked-time.dto';
import { invalidateDoctorCaches } from '@/public/cache';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AvailabilityService {
  constructor(private prisma: PrismaService) {}

  /** Returns the doctor's global weekly working hours (no location), ordered Mon–Sun (0=Sun). */
  getSchedule(userId: string) {
    return this.prisma.working_hours.findMany({
      where: { profile_id: userId, location_id: null },
      orderBy: { day_of_week: 'asc' },
    });
  }

  /**
   * Replaces the entire global weekly schedule in a single transaction.
   * Only touches hours where location_id IS NULL — never deletes location-specific hours.
   */
  async updateSchedule(userId: string, dto: UpdateAvailabilityDto) {
    await this.prisma.$transaction(async (tx) => {
      await tx.working_hours.deleteMany({ where: { profile_id: userId, location_id: null } });
      await tx.working_hours.createMany({
        data: dto.schedule.map((s) => ({
          id: uuidv4(),
          profile_id: userId,
          day_of_week: s.dayOfWeek,
          start_time: new Date(`1970-01-01T${s.startTime}:00Z`),
          end_time: new Date(`1970-01-01T${s.endTime}:00Z`),
          is_enabled: s.isEnabled,
        })),
      });
    });
    invalidateDoctorCaches(userId);
    return this.getSchedule(userId);
  }

  /** Returns future global blocked times (no location) ordered by date then start time. */
  getBlockedTimes(userId: string) {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    return this.prisma.blocked_time.findMany({
      where: { profile_id: userId, location_id: null, date: { gte: startOfToday } },
      orderBy: [{ date: 'asc' }, { start_time: 'asc' }],
    });
  }

  /** Blocks a specific time range on a date (e.g. lunch break, holiday). */
  async createBlockedTime(userId: string, dto: CreateBlockedTimeDto) {
    const result = await this.prisma.blocked_time.create({
      data: {
        id: uuidv4(),
        profile_id: userId,
        date: new Date(dto.date),
        start_time: new Date(`1970-01-01T${dto.startTime}:00Z`),
        end_time: new Date(`1970-01-01T${dto.endTime}:00Z`),
        reason: dto.reason ?? null,
      },
    });
    invalidateDoctorCaches(userId);
    return result;
  }

  /**
   * Removes a blocked time slot.
   * Uses deleteMany with profile_id check to avoid 403/404 — safe no-op if already deleted.
   */
  async deleteBlockedTime(userId: string, id: string) {
    await this.prisma.blocked_time.deleteMany({ where: { id, profile_id: userId } });
    invalidateDoctorCaches(userId);
    return { message: 'Blocked time removed' };
  }
}
