import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { subDays, startOfDay } from 'date-fns';
import { PrismaService } from '@/database/prisma.service';
import { EmailService } from '@/email/email.service';
import { invalidateDoctorCaches } from '@/public/cache';
import { ConfigService } from '@nestjs/config';
import { VerifyDoctorDto } from './dto/verify-doctor.dto';
import { AdminUpdateDoctorProfileDto } from './dto/admin-update-doctor-profile.dto';
import { AdminUpdateScheduleDto } from './dto/admin-update-schedule.dto';
import { AdminCreateServiceCategoryDto, AdminCreateServiceDto, AdminUpdateServiceDto, AdminUpdateLocationDto, AdminCreateLocationDto, AdminAddLocationServiceDto, AdminUpdateLocationServiceDto } from './dto/admin-service.dto';
import { AdminAppointmentsQueryDto } from './dto/admin-appointments-query.dto';
import { BulkVerifyDto } from './dto/bulk-verify.dto';
import { AdminVerificationDto } from './dto/admin-verification.dto';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private config: ConfigService,
  ) {}

  async getDoctors(status?: string) {
    return this.prisma.user.findMany({
      where: {
        role: 'DOCTOR',
        ...(status ? { doctor_profile: { verification_status: status as any } } : {}),
      },
      select: {
        id: true,
        email: true,
        full_name: true,
        business_name: true,
        avatar_url: true,
        created_at: true,
        doctor_profile: {
          select: {
            specialty: true,
            medical_association_number: true,
            verification_status: true,
            rejection_reason: true,
            accepts_gessy: true,
            accepts_eopyy: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async getStats() {
    const [
      doctorsPending,
      doctorsApproved,
      doctorsRejected,
      totalPatients,
      totalAppointments,
      revenueRows,
    ] = await Promise.all([
      this.prisma.doctorProfile.count({ where: { verification_status: 'PENDING' } }),
      this.prisma.doctorProfile.count({ where: { verification_status: 'APPROVED' } }),
      this.prisma.doctorProfile.count({ where: { verification_status: 'REJECTED' } }),
      this.prisma.user.count({ where: { role: 'PATIENT' } }),
      this.prisma.appointments.count(),
      this.prisma.$queryRaw<[{ total: number }]>`
        SELECT COALESCE(SUM(s.price), 0)::float8 AS total
        FROM appointments a
        JOIN appointment_services aps ON aps.appointment_id = a.id
        JOIN services s ON aps.service_id = s.id
        WHERE a.status = 'completed'
      `,
    ]);

    return {
      doctors: { pending: doctorsPending, approved: doctorsApproved, rejected: doctorsRejected },
      totalPatients,
      totalAppointments,
      totalRevenue: revenueRows[0]?.total ?? 0,
    };
  }

  async searchUsers(q?: string, role?: string) {
    return this.prisma.user.findMany({
      where: {
        ...(role ? { role: role as UserRole } : { role: { in: [UserRole.DOCTOR, UserRole.PATIENT] } }),
        ...(q ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { full_name: { contains: q, mode: 'insensitive' } },
            { business_name: { contains: q, mode: 'insensitive' } },
          ],
        } : {}),
      },
      select: {
        id: true,
        email: true,
        full_name: true,
        business_name: true,
        avatar_url: true,
        role: true,
        is_suspended: true,
        created_at: true,
        doctor_profile: { select: { specialty: true, verification_status: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  }

  async getDoctorDetail(doctorId: string) {
    const [doctor, totalAppointments, upcomingAppointments, services, categories, locations] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: doctorId },
        include: {
          doctor_profile: true,
          working_hours: { orderBy: { day_of_week: 'asc' } },
        },
      }),
      this.prisma.appointments.count({ where: { profile_id: doctorId } }),
      this.prisma.appointments.findMany({
        where: { profile_id: doctorId, start_time: { gte: new Date() }, status: { not: 'cancelled' } },
        include: { appointment_services: { include: { service: { select: { name: true } } } } },
        orderBy: { start_time: 'asc' },
        take: 5,
      }),
      this.prisma.services.findMany({
        where: { profile_id: doctorId, is_active: true },
        select: { id: true, name: true, duration_minutes: true, price: true, price_min: true, price_max: true, category_id: true },
      }),
      this.prisma.service_categories.findMany({
        where: { profile_id: doctorId },
        select: { id: true, name: true, order: true },
        orderBy: { order: 'asc' },
      }),
      this.prisma.locations.findMany({
        where: { profile_id: doctorId },
        include: {
          working_hours: { orderBy: { day_of_week: 'asc' } },
          location_services: {
            where: { is_active: true },
            include: {
              service: { select: { id: true, name: true, duration_minutes: true, price: true } },
            },
          },
        },
        orderBy: { order: 'asc' },
      }),
    ]);

    if (!doctor) throw new NotFoundException('Doctor not found');
    const { password, ...safeDoctor } = doctor as any;
    return { doctor: safeDoctor, totalAppointments, upcomingAppointments, services, categories, locations };
  }

  async getReviews() {
    return this.prisma.review.findMany({
      include: {
        doctor: { select: { id: true, full_name: true, business_name: true, avatar_url: true } },
        appointment: { select: { client_name: true, client_email: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
  }

  async toggleReviewVisibility(reviewId: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');
    return this.prisma.review.update({
      where: { id: reviewId },
      data: { is_visible: !review.is_visible, updated_at: new Date() },
    });
  }

  async verifyDoctor(doctorId: string, dto: VerifyDoctorDto) {
    const doctor = await this.prisma.user.findUnique({
      where: { id: doctorId },
      select: {
        email: true,
        full_name: true,
        business_name: true,
        avatar_url: true,
        doctor_profile: {
          select: {
            id: true,
            specialty: true,
            phone: true,
            medical_association_number: true,
            afm: true,
            id_photo_url: true,
            terms_accepted: true,
            education: true,
          },
        },
      },
    });
    if (!doctor?.doctor_profile) throw new NotFoundException('Doctor profile not found');

    if (dto.status === 'APPROVED') {
      const missingFields = this.getMissingProfileFields(doctor);
      if (missingFields.length > 0) {
        throw new BadRequestException({ message: 'Το προφίλ δεν είναι πλήρες', missingFields });
      }
    }

    const appUrl = this.config.get<string>('appUrl') ?? 'https://bookpro.gr';
    const name = doctor.business_name || doctor.full_name || doctor.email;

    const updated = await this.prisma.doctorProfile.update({
      where: { user_id: doctorId },
      data: {
        verification_status: dto.status,
        rejection_reason: dto.status === 'REJECTED' ? (dto.reason ?? null) : null,
        updated_at: new Date(),
      },
    });

    if (dto.status === 'APPROVED') {
      this.email.sendDoctorApproved({ to: doctor.email, name, appUrl }).catch(() => {});
    } else if (dto.status === 'REJECTED') {
      this.email.sendDoctorRejected({ to: doctor.email, name, reason: dto.reason, appUrl }).catch(() => {});
    }

    invalidateDoctorCaches(doctorId); // verification status controls public visibility
    return updated;
  }

  async suspendUser(userId: string, suspend: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'ADMIN') throw new ForbiddenException('Cannot suspend admin accounts');
    const result = await this.prisma.user.update({
      where: { id: userId },
      data: {
        is_suspended: suspend,
        sessions_invalidated_at: suspend ? new Date() : null,
        updated_at: new Date(),
      },
      select: { id: true, is_suspended: true },
    });
    invalidateDoctorCaches(userId); // suspended users are hidden from public listings
    return result;
  }

  async deleteUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'ADMIN') throw new ForbiddenException('Cannot delete admin accounts');
    await this.prisma.user.delete({ where: { id: userId } });
    invalidateDoctorCaches(userId);
    return { message: 'User deleted' };
  }

  async getAdminAppointments(dto: AdminAppointmentsQueryDto) {
    const { status, doctorId, specialty, from, to, q, page = 1, limit = 40 } = dto;

    const where: any = {};
    if (status) where.status = status;
    if (doctorId) where.profile_id = doctorId;
    if (specialty) where.profiles = { doctor_profile: { specialty: specialty as any } };
    if (from || to) {
      where.start_time = {};
      if (from) where.start_time.gte = new Date(from);
      if (to) where.start_time.lte = new Date(to + 'T23:59:59.999Z');
    }
    if (q) {
      where.OR = [
        { client_name: { contains: q, mode: 'insensitive' } },
        { client_email: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, data] = await Promise.all([
      this.prisma.appointments.count({ where }),
      this.prisma.appointments.findMany({
        where,
        include: {
          profiles: {
            select: {
              id: true,
              full_name: true,
              business_name: true,
              avatar_url: true,
              doctor_profile: { select: { specialty: true } },
            },
          },
          appointment_services: { include: { service: { select: { id: true, name: true, price: true, duration_minutes: true } } } },
        },
        orderBy: { start_time: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { data, total, page, limit };
  }

  async updateAdminAppointmentStatus(appointmentId: string, status: string) {
    const appt = await this.prisma.appointments.findUnique({
      where: { id: appointmentId },
      select: { id: true },
    });
    if (!appt) throw new NotFoundException('Appointment not found');

    return this.prisma.appointments.update({
      where: { id: appointmentId },
      data: {
        status,
        cancelled_by: status === 'cancelled' ? 'admin' : null,
        updated_at: new Date(),
      },
      select: { id: true, status: true, cancelled_by: true },
    });
  }

  async getAdminAnalytics(days: number) {
    const since = startOfDay(subDays(new Date(), days - 1));

    const [
      dailyRaw,
      specialtyRaw,
      userGrowthRaw,
      topDoctorsRaw,
      newDoctors,
      newPatients,
      periodBookings,
      periodCompleted,
    ] = await Promise.all([
      // Daily bookings + revenue (in period)
      this.prisma.$queryRaw<{ date: string; bookings: number; revenue: number }[]>`
        SELECT
          DATE(a.start_time AT TIME ZONE 'UTC')::text AS date,
          COUNT(*)::int                               AS bookings,
          COALESCE(SUM(CASE WHEN a.status = 'completed' THEN s.price ELSE 0 END), 0)::float8 AS revenue
        FROM appointments a
        LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
        LEFT JOIN services s ON aps.service_id = s.id
        WHERE a.start_time >= ${since}
        GROUP BY date
        ORDER BY date
      `,

      // Bookings by specialty (all time)
      this.prisma.$queryRaw<{ specialty: string; count: number }[]>`
        SELECT dp.specialty::text AS specialty, COUNT(*)::int AS count
        FROM appointments a
        JOIN doctor_profiles dp ON a.profile_id = dp.user_id
        WHERE dp.specialty IS NOT NULL
        GROUP BY dp.specialty
        ORDER BY count DESC
        LIMIT 10
      `,

      // New user registrations per day per role (in period)
      this.prisma.$queryRaw<{ date: string; role: string; count: number }[]>`
        SELECT
          DATE(created_at AT TIME ZONE 'UTC')::text AS date,
          role::text                                AS role,
          COUNT(*)::int                             AS count
        FROM profiles
        WHERE created_at >= ${since} AND role IN ('DOCTOR', 'PATIENT')
        GROUP BY date, role
        ORDER BY date
      `,

      // Top 5 doctors by total appointments
      this.prisma.$queryRaw<{ id: string; name: string; avatar_url: string | null; specialty: string | null; total_appointments: number }[]>`
        SELECT
          p.id,
          COALESCE(p.business_name, p.full_name, p.email) AS name,
          p.avatar_url,
          dp.specialty::text AS specialty,
          COUNT(a.id)::int   AS total_appointments
        FROM profiles p
        JOIN doctor_profiles dp ON p.id = dp.user_id
        LEFT JOIN appointments a ON p.id = a.profile_id
        WHERE p.role = 'DOCTOR'
        GROUP BY p.id, p.business_name, p.full_name, p.email, p.avatar_url, dp.specialty
        ORDER BY total_appointments DESC
        LIMIT 5
      `,

      this.prisma.user.count({ where: { role: 'DOCTOR', created_at: { gte: since } } }),
      this.prisma.user.count({ where: { role: 'PATIENT', created_at: { gte: since } } }),
      this.prisma.appointments.count({ where: { start_time: { gte: since } } }),
      this.prisma.appointments.count({ where: { start_time: { gte: since }, status: 'completed' } }),
    ]);

    const completionRate = periodBookings > 0
      ? Math.round((periodCompleted / periodBookings) * 100)
      : 0;

    const periodRevenue = dailyRaw.reduce((s, d) => s + Number(d.revenue), 0);

    // Fill every day in the period with zero if no data
    const dayMap = new Map(dailyRaw.map((d) => [d.date, d]));
    const dailyStats = Array.from({ length: days }, (_, i) => {
      const date = subDays(new Date(), days - 1 - i).toISOString().substring(0, 10);
      return { date, bookings: dayMap.get(date)?.bookings ?? 0, revenue: Number(dayMap.get(date)?.revenue ?? 0) };
    });

    // User growth — cumulative per day
    type GrowthDay = { date: string; doctors: number; patients: number; cumDoctors: number; cumPatients: number };
    const growthDayMap = new Map<string, { doctors: number; patients: number }>();
    for (const row of userGrowthRaw) {
      if (!growthDayMap.has(row.date)) growthDayMap.set(row.date, { doctors: 0, patients: 0 });
      const entry = growthDayMap.get(row.date)!;
      if (row.role === 'DOCTOR') entry.doctors += Number(row.count);
      else entry.patients += Number(row.count);
    }
    let cumD = 0, cumP = 0;
    const userGrowth: GrowthDay[] = Array.from({ length: days }, (_, i) => {
      const date = subDays(new Date(), days - 1 - i).toISOString().substring(0, 10);
      const g = growthDayMap.get(date) ?? { doctors: 0, patients: 0 };
      cumD += g.doctors; cumP += g.patients;
      return { date, doctors: g.doctors, patients: g.patients, cumDoctors: cumD, cumPatients: cumP };
    });

    return {
      days,
      totalRevenue: periodRevenue,
      totalBookings: periodBookings,
      completionRate,
      newDoctors,
      newPatients,
      dailyStats,
      bookingsBySpecialty: specialtyRaw.map((r) => ({ specialty: r.specialty, count: Number(r.count) })),
      userGrowth,
      topDoctors: topDoctorsRaw.map((d) => ({
        id: d.id,
        name: d.name,
        avatarUrl: d.avatar_url,
        specialty: d.specialty,
        totalAppointments: Number(d.total_appointments),
      })),
    };
  }

  async bulkVerifyDoctors(dto: BulkVerifyDto) {
    const appUrl = this.config.get<string>('appUrl') ?? 'https://bookpro.gr';

    // For rejection no completeness check is needed — reject all at once
    if (dto.status !== 'APPROVED') {
      await this.prisma.doctorProfile.updateMany({
        where: { user_id: { in: dto.ids } },
        data: { verification_status: dto.status, rejection_reason: dto.reason ?? null, updated_at: new Date() },
      });
      const doctors = await this.prisma.user.findMany({
        where: { id: { in: dto.ids }, role: 'DOCTOR' },
        select: { email: true, full_name: true, business_name: true },
      });
      for (const doc of doctors) {
        const name = doc.business_name || doc.full_name || doc.email;
        this.email.sendDoctorRejected({ to: doc.email, name, reason: dto.reason, appUrl }).catch(() => {});
      }
      invalidateDoctorCaches();
      return { approved: 0, rejected: dto.ids.length, skipped: [] };
    }

    // For approval, check each doctor's completeness individually
    const doctors = await this.prisma.user.findMany({
      where: { id: { in: dto.ids }, role: 'DOCTOR' },
      select: {
        id: true,
        email: true,
        full_name: true,
        business_name: true,
        avatar_url: true,
        doctor_profile: {
          select: {
            specialty: true,
            phone: true,
            medical_association_number: true,
            afm: true,
            id_photo_url: true,
            terms_accepted: true,
            education: true,
          },
        },
      },
    });

    const approvedIds: string[] = [];
    const skipped: { id: string; name: string; missingFields: string[] }[] = [];

    for (const doc of doctors) {
      const missingFields = this.getMissingProfileFields(doc);
      if (missingFields.length > 0) {
        skipped.push({ id: doc.id, name: doc.business_name || doc.full_name || doc.email, missingFields });
      } else {
        approvedIds.push(doc.id);
      }
    }

    if (approvedIds.length > 0) {
      await this.prisma.doctorProfile.updateMany({
        where: { user_id: { in: approvedIds } },
        data: { verification_status: 'APPROVED', rejection_reason: null, updated_at: new Date() },
      });
      for (const doc of doctors.filter((d) => approvedIds.includes(d.id))) {
        const name = doc.business_name || doc.full_name || doc.email;
        this.email.sendDoctorApproved({ to: doc.email, name, appUrl }).catch(() => {});
      }
      invalidateDoctorCaches();
    }

    return { approved: approvedIds.length, skipped };
  }

  async updateDoctorVerification(doctorId: string, dto: AdminVerificationDto) {
    await this.assertDoctor(doctorId);

    const data: Record<string, unknown> = { updated_at: new Date() };
    if (dto.adminNotes !== undefined) data.admin_notes = dto.adminNotes;
    if (dto.checklist !== undefined) data.verification_checklist = dto.checklist;

    await this.prisma.doctorProfile.update({
      where: { user_id: doctorId },
      data,
    });

    return this.getDoctorDetail(doctorId);
  }

  private async assertDoctor(doctorId: string) {
    const doc = await this.prisma.user.findUnique({ where: { id: doctorId }, select: { id: true, role: true } });
    if (!doc || doc.role !== 'DOCTOR') throw new NotFoundException('Doctor not found');
  }

  private getMissingProfileFields(doctor: {
    full_name: string | null;
    avatar_url: string | null;
    doctor_profile: {
      specialty: string | null;
      phone: string | null;
      medical_association_number: string | null;
      afm: string | null;
      id_photo_url: string | null;
      terms_accepted: boolean | null;
      education: string | null;
    } | null;
  }): string[] {
    const dp = doctor.doctor_profile;
    const missing: string[] = [];
    if (!doctor.avatar_url) missing.push('Φωτογραφία προφίλ');
    if (!doctor.full_name) missing.push('Πλήρες όνομα');
    if (!dp?.specialty) missing.push('Ειδικότητα');
    if (!dp?.phone) missing.push('Τηλέφωνο');
    if (!dp?.medical_association_number) missing.push('ΑΜ Ιατρικού Συλλόγου');
    if (!dp?.afm) missing.push('ΑΦΜ');
    if (!dp?.id_photo_url) missing.push('Φωτογραφία ταυτότητας');
    if (!dp?.terms_accepted) missing.push('Αποδοχή όρων χρήσης');
    if (!dp?.education) missing.push('Τίτλοι σπουδών');
    return missing;
  }

  async updateDoctorProfile(doctorId: string, dto: AdminUpdateDoctorProfileDto) {
    await this.assertDoctor(doctorId);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: doctorId },
        data: {
          ...(dto.fullName !== undefined && { full_name: dto.fullName }),
          ...(dto.businessName !== undefined && { business_name: dto.businessName }),
          ...(dto.bio !== undefined && { bio: dto.bio }),
          ...(dto.address !== undefined && { address: dto.address }),
          updated_at: new Date(),
        },
      });

      const dpFields: Record<string, unknown> = {};
      if (dto.specialty !== undefined) dpFields.specialty = dto.specialty;
      if (dto.medicalAssociationNumber !== undefined) dpFields.medical_association_number = dto.medicalAssociationNumber;
      if (dto.afm !== undefined) dpFields.afm = dto.afm;
      if (dto.doctorPhone !== undefined) dpFields.phone = dto.doctorPhone;
      if (dto.education !== undefined) dpFields.education = dto.education;
      if (dto.acceptsGessy !== undefined) dpFields.accepts_gessy = dto.acceptsGessy;
      if (dto.acceptsEopyy !== undefined) dpFields.accepts_eopyy = dto.acceptsEopyy;

      if (Object.keys(dpFields).length > 0) {
        await tx.doctorProfile.update({
          where: { user_id: doctorId },
          data: { ...dpFields, updated_at: new Date() },
        });
      }
    });

    invalidateDoctorCaches(doctorId);
    return this.getDoctorDetail(doctorId);
  }

  async updateDoctorSchedule(doctorId: string, dto: AdminUpdateScheduleDto) {
    await this.assertDoctor(doctorId);

    await this.prisma.$transaction(async (tx) => {
      await tx.working_hours.deleteMany({ where: { profile_id: doctorId } });
      await tx.working_hours.createMany({
        data: dto.schedule.map((s) => ({
          id: uuidv4(),
          profile_id: doctorId,
          day_of_week: s.dayOfWeek,
          start_time: new Date(`1970-01-01T${s.startTime}:00Z`),
          end_time: new Date(`1970-01-01T${s.endTime}:00Z`),
          is_enabled: s.isEnabled,
        })),
      });
    });

    invalidateDoctorCaches(doctorId);
    return this.getDoctorDetail(doctorId);
  }

  async createDoctorServiceCategory(doctorId: string, dto: AdminCreateServiceCategoryDto) {
    await this.assertDoctor(doctorId);
    const agg = await this.prisma.service_categories.aggregate({
      where: { profile_id: doctorId },
      _max: { order: true },
    });
    const result = await this.prisma.service_categories.create({
      data: {
        id: uuidv4(),
        profile_id: doctorId,
        name: dto.name,
        order: (agg._max.order ?? -1) + 1,
      },
      select: { id: true, name: true, order: true },
    });
    invalidateDoctorCaches(doctorId);
    return result;
  }

  async createDoctorService(doctorId: string, dto: AdminCreateServiceDto) {
    await this.assertDoctor(doctorId);
    const result = await this.prisma.services.create({
      data: {
        id: uuidv4(),
        profile_id: doctorId,
        name: dto.name,
        description: dto.description ?? null,
        price: dto.price ?? null,
        price_min: dto.priceMin ?? null,
        price_max: dto.priceMax ?? null,
        duration_minutes: dto.durationMinutes,
        ...(dto.categoryId ? { category_id: dto.categoryId } : {}),
      },
      select: { id: true, name: true, duration_minutes: true, price: true, price_min: true, price_max: true, description: true, is_active: true, category_id: true },
    });
    invalidateDoctorCaches(doctorId);
    return result;
  }

  async updateDoctorService(doctorId: string, serviceId: string, dto: AdminUpdateServiceDto) {
    const svc = await this.prisma.services.findUnique({ where: { id: serviceId }, select: { profile_id: true } });
    if (!svc) throw new NotFoundException('Service not found');
    if (svc.profile_id !== doctorId) throw new ForbiddenException();

    const result = await this.prisma.services.update({
      where: { id: serviceId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.priceMin !== undefined && { price_min: dto.priceMin }),
        ...(dto.priceMax !== undefined && { price_max: dto.priceMax }),
        ...(dto.durationMinutes !== undefined && { duration_minutes: dto.durationMinutes }),
        ...(dto.isActive !== undefined && { is_active: dto.isActive }),
        updated_at: new Date(),
      },
      select: { id: true, name: true, duration_minutes: true, price: true, price_min: true, price_max: true, description: true, is_active: true, category_id: true },
    });
    invalidateDoctorCaches(doctorId);
    return result;
  }

  async deleteDoctorService(doctorId: string, serviceId: string) {
    const svc = await this.prisma.services.findUnique({ where: { id: serviceId }, select: { profile_id: true } });
    if (!svc) throw new NotFoundException('Service not found');
    if (svc.profile_id !== doctorId) throw new ForbiddenException();
    await this.prisma.services.delete({ where: { id: serviceId } });
    invalidateDoctorCaches(doctorId);
    return { message: 'Service deleted' };
  }

  async deleteDoctorServiceCategory(doctorId: string, categoryId: string) {
    const cat = await this.prisma.service_categories.findUnique({ where: { id: categoryId }, select: { profile_id: true } });
    if (!cat) throw new NotFoundException('Category not found');
    if (cat.profile_id !== doctorId) throw new ForbiddenException();
    await this.prisma.service_categories.delete({ where: { id: categoryId } });
    invalidateDoctorCaches(doctorId);
    return { message: 'Category deleted' };
  }

  private readonly locationServiceInclude = {
    service: { select: { id: true, name: true, duration_minutes: true, price: true } },
  } as const;

  async addLocationService(doctorId: string, locationId: string, dto: AdminAddLocationServiceDto) {
    const loc = await this.prisma.locations.findUnique({ where: { id: locationId }, select: { profile_id: true } });
    if (!loc) throw new NotFoundException('Location not found');
    if (loc.profile_id !== doctorId) throw new ForbiddenException();

    const svc = await this.prisma.services.findUnique({ where: { id: dto.serviceId }, select: { profile_id: true } });
    if (!svc) throw new NotFoundException('Service not found');
    if (svc.profile_id !== doctorId) throw new ForbiddenException();

    const result = await this.prisma.location_services.create({
      data: {
        id: uuidv4(),
        location_id: locationId,
        service_id: dto.serviceId,
        price_override: dto.priceOverride ?? null,
        duration_override: dto.durationOverride ?? null,
        is_active: true,
      },
      include: this.locationServiceInclude,
    });
    invalidateDoctorCaches(doctorId);
    return result;
  }

  async updateLocationService(doctorId: string, locationId: string, locServiceId: string, dto: AdminUpdateLocationServiceDto) {
    const ls = await this.prisma.location_services.findUnique({ where: { id: locServiceId }, select: { location_id: true } });
    if (!ls) throw new NotFoundException('Location service not found');
    if (ls.location_id !== locationId) throw new ForbiddenException();
    const loc = await this.prisma.locations.findUnique({ where: { id: locationId }, select: { profile_id: true } });
    if (loc?.profile_id !== doctorId) throw new ForbiddenException();

    const result = await this.prisma.location_services.update({
      where: { id: locServiceId },
      data: {
        ...(dto.priceOverride !== undefined && { price_override: dto.priceOverride }),
        ...(dto.durationOverride !== undefined && { duration_override: dto.durationOverride }),
      },
      include: this.locationServiceInclude,
    });
    invalidateDoctorCaches(doctorId);
    return result;
  }

  async removeLocationService(doctorId: string, locationId: string, locServiceId: string) {
    const ls = await this.prisma.location_services.findUnique({ where: { id: locServiceId }, select: { location_id: true } });
    if (!ls) throw new NotFoundException('Location service not found');
    if (ls.location_id !== locationId) throw new ForbiddenException();
    const loc = await this.prisma.locations.findUnique({ where: { id: locationId }, select: { profile_id: true } });
    if (loc?.profile_id !== doctorId) throw new ForbiddenException();

    await this.prisma.location_services.delete({ where: { id: locServiceId } });
    invalidateDoctorCaches(doctorId);
    return { message: 'Service removed from location' };
  }

  async createDoctorLocation(doctorId: string, dto: AdminCreateLocationDto) {
    await this.assertDoctor(doctorId);
    const agg = await this.prisma.locations.aggregate({
      where: { profile_id: doctorId },
      _max: { order: true },
    });
    const result = await this.prisma.locations.create({
      data: {
        id: uuidv4(),
        profile_id: doctorId,
        name: dto.name,
        address: dto.address ?? null,
        phone: dto.phone ?? null,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        is_active: true,
        order: (agg._max.order ?? -1) + 1,
      },
      include: {
        working_hours: true,
        location_services: {
          where: { is_active: true },
          include: {
            service: { select: { id: true, name: true, duration_minutes: true, price: true } },
          },
        },
      },
    });
    invalidateDoctorCaches(doctorId);
    return result;
  }

  async deleteDoctorLocation(doctorId: string, locationId: string) {
    const loc = await this.prisma.locations.findUnique({ where: { id: locationId }, select: { profile_id: true } });
    if (!loc) throw new NotFoundException('Location not found');
    if (loc.profile_id !== doctorId) throw new ForbiddenException();
    await this.prisma.locations.delete({ where: { id: locationId } });
    invalidateDoctorCaches(doctorId);
    return { message: 'Location deleted' };
  }

  async updateDoctorLocation(doctorId: string, locationId: string, dto: AdminUpdateLocationDto) {
    const loc = await this.prisma.locations.findUnique({ where: { id: locationId }, select: { profile_id: true } });
    if (!loc) throw new NotFoundException('Location not found');
    if (loc.profile_id !== doctorId) throw new ForbiddenException();

    const result = await this.prisma.locations.update({
      where: { id: locationId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.isActive !== undefined && { is_active: dto.isActive }),
        ...(dto.lat !== undefined && { lat: dto.lat }),
        ...(dto.lng !== undefined && { lng: dto.lng }),
      },
      select: { id: true, name: true, address: true, phone: true, is_active: true, order: true },
    });
    invalidateDoctorCaches(doctorId);
    return result;
  }

  async updateDoctorLocationSchedule(doctorId: string, locationId: string, dto: AdminUpdateScheduleDto) {
    const loc = await this.prisma.locations.findUnique({ where: { id: locationId }, select: { profile_id: true } });
    if (!loc) throw new NotFoundException('Location not found');
    if (loc.profile_id !== doctorId) throw new ForbiddenException();

    await this.prisma.$transaction(async (tx) => {
      await tx.working_hours.deleteMany({ where: { profile_id: doctorId, location_id: locationId } });
      await tx.working_hours.createMany({
        data: dto.schedule.map((s) => ({
          id: uuidv4(),
          profile_id: doctorId,
          location_id: locationId,
          day_of_week: s.dayOfWeek,
          start_time: new Date(`1970-01-01T${s.startTime}:00Z`),
          end_time: new Date(`1970-01-01T${s.endTime}:00Z`),
          is_enabled: s.isEnabled,
        })),
      });
    });

    invalidateDoctorCaches(doctorId);
    return this.getDoctorDetail(doctorId);
  }
}
