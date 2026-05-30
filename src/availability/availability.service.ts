import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { CreateBlockedTimeDto } from './dto/blocked-time.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AvailabilityService {
  constructor(private prisma: PrismaService) {}

  getSchedule(userId: string) {
    return this.prisma.working_hours.findMany({
      where: { profile_id: userId },
      orderBy: { day_of_week: 'asc' },
    });
  }

  async updateSchedule(userId: string, dto: UpdateAvailabilityDto) {
    await this.prisma.$transaction(async (tx) => {
      await tx.working_hours.deleteMany({ where: { profile_id: userId } });
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
    return this.getSchedule(userId);
  }

  getBlockedTimes(userId: string) {
    return this.prisma.blocked_time.findMany({
      where: { profile_id: userId },
      orderBy: [{ date: 'asc' }, { start_time: 'asc' }],
    });
  }

  createBlockedTime(userId: string, dto: CreateBlockedTimeDto) {
    return this.prisma.blocked_time.create({
      data: {
        id: uuidv4(),
        profile_id: userId,
        date: new Date(dto.date),
        start_time: new Date(`1970-01-01T${dto.startTime}:00Z`),
        end_time: new Date(`1970-01-01T${dto.endTime}:00Z`),
        reason: dto.reason ?? null,
      },
    });
  }

  async deleteBlockedTime(userId: string, id: string) {
    await this.prisma.blocked_time.deleteMany({ where: { id, profile_id: userId } });
    return { message: 'Blocked time removed' };
  }
}
