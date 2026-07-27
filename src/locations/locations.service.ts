import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { invalidateDoctorCaches } from '@/public/cache';
import { resolveTimezone, wallClockToUtc } from '@/common/time/tz.util';
import { assertValidScheduleBlocks, toWorkingHourRow, assertBlockedRangeFree } from '@/common/time/schedule.util';
import { CreateLocationDto, UpdateLocationDto } from './dto/create-location.dto';
import {
  AddLocationServiceDto,
  UpdateLocationServiceDto,
  UpdateLocationScheduleDto,
  CreateLocationBlockedTimeDto,
  UpdateLocationBlockedTimeDto,
} from './dto/location-service.dto';

/** Today at 00:00 UTC — matches how blocked_time.date is stored (UTC-midnight per calendar date). */
function startOfTodayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class LocationsService {
  constructor(private prisma: PrismaService) {}

  // ── Location CRUD ──────────────────────────────────────────────────────────

  findAll(userId: string) {
    return this.prisma.locations.findMany({
      where: { profile_id: userId },
      include: {
        location_services: {
          include: { service: { select: { id: true, name: true, price: true, duration_minutes: true } } },
          orderBy: { created_at: 'asc' },
        },
        working_hours: { orderBy: [{ day_of_week: 'asc' }, { start_time: 'asc' }] },
      },
      orderBy: [{ order: 'asc' }, { created_at: 'asc' }],
    });
  }

  async create(userId: string, dto: CreateLocationDto) {
    const result = await this.prisma.locations.create({
      data: {
        id: uuidv4(),
        profile_id: userId,
        name: dto.name,
        address: dto.address ?? null,
        phone: dto.phone ?? null,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        order: dto.order ?? 0,
      },
    });
    invalidateDoctorCaches(userId);
    return result;
  }

  async update(userId: string, locationId: string, dto: UpdateLocationDto) {
    await this.assertOwnership(userId, locationId);
    const result = await this.prisma.locations.update({
      where: { id: locationId },
      data: {
        name: dto.name,
        address: dto.address,
        phone: dto.phone,
        lat: dto.lat,
        lng: dto.lng,
        is_active: dto.isActive,
        order: dto.order,
        updated_at: new Date(),
      },
    });
    invalidateDoctorCaches(userId);
    return result;
  }

  async remove(userId: string, locationId: string) {
    await this.assertOwnership(userId, locationId);
    await this.prisma.locations.delete({ where: { id: locationId } });
    invalidateDoctorCaches(userId);
    return { message: 'Location deleted' };
  }

  // ── Per-location schedule ──────────────────────────────────────────────────

  async getSchedule(userId: string, locationId: string) {
    await this.assertOwnership(userId, locationId);
    return this.prisma.working_hours.findMany({
      where: { location_id: locationId },
      orderBy: [{ day_of_week: 'asc' }, { start_time: 'asc' }],
    });
  }

  async updateSchedule(userId: string, locationId: string, dto: UpdateLocationScheduleDto) {
    await this.assertOwnership(userId, locationId);
    assertValidScheduleBlocks(dto.schedule);

    await this.prisma.$transaction(async (tx) => {
      await tx.working_hours.deleteMany({ where: { location_id: locationId } });
      await tx.working_hours.createMany({
        data: dto.schedule.map((s, i) => ({
          id: uuidv4(),
          profile_id: userId,
          location_id: locationId,
          ...toWorkingHourRow(s, i),
        })),
      });
    });
    invalidateDoctorCaches(userId);
    return this.getSchedule(userId, locationId);
  }

  // ── Per-location blocked time ──────────────────────────────────────────────

  async getBlockedTimes(userId: string, locationId: string) {
    await this.assertOwnership(userId, locationId);
    return this.prisma.blocked_time.findMany({
      where: { location_id: locationId, date: { gte: startOfTodayUtc() } },
      orderBy: [{ date: 'asc' }, { start_time: 'asc' }],
    });
  }

  /**
   * A date may hold several blocked times (one break per shift), as long as they
   * don't overlap. `excludeId` skips the row being edited.
   */
  private async assertValidBlockedRange(
    locationId: string,
    date: Date,
    startTime: string,
    endTime: string,
    excludeId?: string,
  ) {
    const existing = await this.prisma.blocked_time.findMany({
      where: { location_id: locationId, date, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { start_time: true, end_time: true },
    });
    assertBlockedRangeFree(existing, startTime, endTime);
  }

  /**
   * Blocking never cancels existing bookings — count how many fall inside the range
   * so the UI can warn the doctor to handle them manually. Wall-clock range is
   * converted to absolute instants in the clinic timezone before comparing.
   */
  private async countConflictingAppointments(
    userId: string,
    locationId: string,
    dateStr: string,
    startTime: string,
    endTime: string,
  ) {
    const [user, location] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
      this.prisma.locations.findUnique({ where: { id: locationId }, select: { timezone: true } }),
    ]);
    const tz = resolveTimezone(user?.timezone, location?.timezone);
    return this.prisma.appointments.count({
      where: {
        profile_id: userId,
        location_id: locationId,
        status: { not: 'cancelled' },
        start_time: { lt: wallClockToUtc(dateStr, endTime, tz) },
        end_time: { gt: wallClockToUtc(dateStr, startTime, tz) },
      },
    });
  }

  async createBlockedTime(userId: string, locationId: string, dto: CreateLocationBlockedTimeDto) {
    await this.assertOwnership(userId, locationId);

    const date = new Date(dto.date);
    await this.assertValidBlockedRange(locationId, date, dto.startTime, dto.endTime);

    const result = await this.prisma.blocked_time.create({
      data: {
        id: uuidv4(),
        profile_id: userId,
        location_id: locationId,
        date,
        start_time: new Date(`1970-01-01T${dto.startTime}:00Z`),
        end_time: new Date(`1970-01-01T${dto.endTime}:00Z`),
        reason: dto.reason ?? null,
      },
    });
    invalidateDoctorCaches(userId);

    const conflictingAppointments = await this.countConflictingAppointments(
      userId,
      locationId,
      dto.date,
      dto.startTime,
      dto.endTime,
    );

    return { ...result, conflictingAppointments };
  }

  /**
   * Changes one block's hours in place. Sets the range exactly as given — so it can
   * also shrink a block — without ever unblocking the slot in between. The date is
   * immutable: moving a block to another day is a delete + create.
   */
  async updateBlockedTime(
    userId: string,
    locationId: string,
    blockedId: string,
    dto: UpdateLocationBlockedTimeDto,
  ) {
    await this.assertOwnership(userId, locationId);

    const existing = await this.prisma.blocked_time.findFirst({
      where: { id: blockedId, location_id: locationId, profile_id: userId },
    });
    if (!existing) throw new NotFoundException('Blocked time not found');

    await this.assertValidBlockedRange(locationId, existing.date, dto.startTime, dto.endTime, blockedId);

    const result = await this.prisma.blocked_time.update({
      where: { id: blockedId },
      data: {
        start_time: new Date(`1970-01-01T${dto.startTime}:00Z`),
        end_time: new Date(`1970-01-01T${dto.endTime}:00Z`),
        ...(dto.reason !== undefined ? { reason: dto.reason ?? null } : {}),
      },
    });
    invalidateDoctorCaches(userId);

    const conflictingAppointments = await this.countConflictingAppointments(
      userId,
      locationId,
      existing.date.toISOString().substring(0, 10),
      dto.startTime,
      dto.endTime,
    );

    return { ...result, conflictingAppointments };
  }

  async deleteBlockedTime(userId: string, locationId: string, blockedId: string) {
    await this.assertOwnership(userId, locationId);
    await this.prisma.blocked_time.deleteMany({
      where: { id: blockedId, location_id: locationId, profile_id: userId },
    });
    invalidateDoctorCaches(userId);
    return { message: 'Blocked time removed' };
  }

  // ── Location services (pivot) ──────────────────────────────────────────────

  async getServices(userId: string, locationId: string) {
    await this.assertOwnership(userId, locationId);
    return this.prisma.location_services.findMany({
      where: { location_id: locationId },
      include: {
        service: {
          select: { id: true, name: true, description: true, price: true, duration_minutes: true, is_active: true },
        },
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async addService(userId: string, locationId: string, dto: AddLocationServiceDto) {
    await this.assertOwnership(userId, locationId);

    const service = await this.prisma.services.findUnique({
      where: { id: dto.serviceId, profile_id: userId },
    });
    if (!service) throw new NotFoundException('Service not found');

    const existing = await this.prisma.location_services.findUnique({
      where: { location_id_service_id: { location_id: locationId, service_id: dto.serviceId } },
    });
    if (existing) throw new ConflictException('Service already added to this location');

    const result = await this.prisma.location_services.create({
      data: {
        id: uuidv4(),
        location_id: locationId,
        service_id: dto.serviceId,
        price_override: dto.priceOverride ?? null,
        duration_override: dto.durationOverride ?? null,
      },
      include: {
        service: { select: { id: true, name: true, description: true, price: true, duration_minutes: true } },
      },
    });
    invalidateDoctorCaches(userId);
    return result;
  }

  async updateService(userId: string, locationId: string, serviceId: string, dto: UpdateLocationServiceDto) {
    await this.assertOwnership(userId, locationId);
    const pivot = await this.prisma.location_services.findUnique({
      where: { location_id_service_id: { location_id: locationId, service_id: serviceId } },
    });
    if (!pivot) throw new NotFoundException('Service not found in this location');

    const result = await this.prisma.location_services.update({
      where: { location_id_service_id: { location_id: locationId, service_id: serviceId } },
      data: {
        price_override: dto.priceOverride !== undefined ? (dto.priceOverride ?? null) : undefined,
        duration_override: dto.durationOverride !== undefined ? (dto.durationOverride ?? null) : undefined,
        is_active: dto.isActive,
      },
      include: {
        service: { select: { id: true, name: true, description: true, price: true, duration_minutes: true } },
      },
    });
    invalidateDoctorCaches(userId);
    return result;
  }

  async removeService(userId: string, locationId: string, serviceId: string) {
    await this.assertOwnership(userId, locationId);
    await this.prisma.location_services.delete({
      where: { location_id_service_id: { location_id: locationId, service_id: serviceId } },
    });
    invalidateDoctorCaches(userId);
    return { message: 'Service removed from location' };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async assertOwnership(userId: string, locationId: string) {
    const location = await this.prisma.locations.findUnique({
      where: { id: locationId },
      select: { profile_id: true },
    });
    if (!location) throw new NotFoundException('Location not found');
    if (location.profile_id !== userId) throw new ForbiddenException();
  }
}
