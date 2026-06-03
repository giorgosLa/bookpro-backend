import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { VerifyDoctorDto } from './dto/verify-doctor.dto';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

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
            license_number: true,
            verification_status: true,
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
    ] = await Promise.all([
      this.prisma.doctorProfile.count({ where: { verification_status: 'PENDING' } }),
      this.prisma.doctorProfile.count({ where: { verification_status: 'APPROVED' } }),
      this.prisma.doctorProfile.count({ where: { verification_status: 'REJECTED' } }),
      this.prisma.user.count({ where: { role: 'PATIENT' } }),
      this.prisma.appointments.count(),
    ]);

    return {
      doctors: { pending: doctorsPending, approved: doctorsApproved, rejected: doctorsRejected },
      totalPatients,
      totalAppointments,
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
        created_at: true,
        doctor_profile: { select: { specialty: true, verification_status: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  }

  async getDoctorDetail(doctorId: string) {
    const [doctor, totalAppointments, upcomingAppointments, services] = await Promise.all([
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
        include: { services: { select: { name: true } } },
        orderBy: { start_time: 'asc' },
        take: 5,
      }),
      this.prisma.services.findMany({
        where: { profile_id: doctorId, is_active: true },
        select: { id: true, name: true, duration_minutes: true, price: true },
      }),
    ]);

    if (!doctor) throw new NotFoundException('Doctor not found');
    const { password, ...safeDoctor } = doctor as any;
    return { doctor: safeDoctor, totalAppointments, upcomingAppointments, services };
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
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { user_id: doctorId },
    });
    if (!profile) throw new NotFoundException('Doctor profile not found');

    return this.prisma.doctorProfile.update({
      where: { user_id: doctorId },
      data: { verification_status: dto.status, updated_at: new Date() },
    });
  }
}
