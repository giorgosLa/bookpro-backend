import { Injectable, ConflictException, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaService } from '@/database/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    cloudinary.config({
      cloud_name: this.config.get<string>('cloudinary.cloudName'),
      api_key: this.config.get<string>('cloudinary.apiKey'),
      api_secret: this.config.get<string>('cloudinary.apiSecret'),
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { doctor_profile: true, patient_profile: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.sanitize(user);
  }

  async update(id: string, dto: UpdateProfileDto) {
    if (dto.bookingUrlSlug) {
      const conflict = await this.prisma.user.findFirst({
        where: { booking_url_slug: dto.bookingUrlSlug, NOT: { id } },
      });
      if (conflict) throw new ConflictException('This URL slug is already taken');
    }

    // Strip identity fields that are immutable while PENDING or APPROVED.
    const currentProfile = await this.prisma.user.findUnique({
      where: { id },
      select: { role: true, doctor_profile: { select: { verification_status: true } } },
    });
    const verificationStatus = currentProfile?.doctor_profile?.verification_status;
    const isDoctor = currentProfile?.role === 'DOCTOR';

    if (isDoctor && (verificationStatus === 'APPROVED' || verificationStatus === 'PENDING')) {
      const d = dto as Record<string, unknown>;
      // Locked for both PENDING and APPROVED
      delete d['fullName'];
      delete d['specialty'];
      delete d['medicalAssociationNumber'];
      delete d['idPhotoUrl'];
      delete d['termsAccepted'];
    }
    if (isDoctor && verificationStatus === 'APPROVED') {
      const d = dto as Record<string, unknown>;
      // Additionally locked only after APPROVED
      delete d['afm'];
      delete d['termsAccepted'];
    }

    const hasDoctorFields = [dto.specialty, dto.acceptsGessy, dto.acceptsEopyy, dto.latitude, dto.longitude, dto.medicalAssociationNumber, dto.afm, dto.idPhotoUrl, dto.termsAccepted, dto.doctorPhone, dto.education, dto.doctorGender].some(
      (v) => v !== undefined,
    );
    const hasPatientFields = [dto.phone, dto.dateOfBirth, dto.gender, dto.amka, dto.eopyyNumber, dto.gessyNumber, dto.bloodType, dto.allergies].some(
      (v) => v !== undefined,
    );

    const doctorData = hasDoctorFields
      ? {
          specialty: dto.specialty,
          accepts_gessy: dto.acceptsGessy,
          accepts_eopyy: dto.acceptsEopyy,
          latitude: dto.latitude,
          longitude: dto.longitude,
          medical_association_number: dto.medicalAssociationNumber,
          afm: dto.afm,
          id_photo_url: dto.idPhotoUrl,
          terms_accepted: dto.termsAccepted,
          phone: dto.doctorPhone,
          education: dto.education,
          gender: dto.doctorGender,
          updated_at: new Date(),
        }
      : undefined;

    const patientData = hasPatientFields
      ? {
          phone: dto.phone,
          date_of_birth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
          gender: dto.gender,
          amka: dto.amka,
          eopyy_number: dto.eopyyNumber,
          gessy_number: dto.gessyNumber,
          blood_type: dto.bloodType,
          allergies: dto.allergies,
          updated_at: new Date(),
        }
      : undefined;

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        business_name: dto.businessName,
        full_name: dto.fullName,
        bio: dto.bio,
        address: dto.address,
        booking_url_slug: dto.bookingUrlSlug,
        timezone: dto.timezone,
        buffer_minutes: dto.bufferMinutes,
        updated_at: new Date(),
        ...(doctorData ? { doctor_profile: { upsert: { create: doctorData, update: doctorData } } } : {}),
        ...(patientData ? { patient_profile: { upsert: { create: patientData, update: patientData } } } : {}),
      },
      include: { doctor_profile: true, patient_profile: true },
    });

    return this.sanitize(updated);
  }

  async resubmitVerification(userId: string) {
    const profile = await this.prisma.doctorProfile.findUnique({ where: { user_id: userId } });
    if (!profile) throw new NotFoundException('Doctor profile not found');
    if (profile.verification_status === 'APPROVED') {
      throw new BadRequestException('Your profile is already approved');
    }
    return this.prisma.doctorProfile.update({
      where: { user_id: userId },
      data: { verification_status: 'PENDING', rejection_reason: null, updated_at: new Date() },
    });
  }

  async getClinicPhotos(userId: string) {
    return this.prisma.doctorPhoto.findMany({
      where: { profile_id: userId },
      orderBy: { order: 'asc' },
    });
  }

  getUploadSignature(userId: string) {
    const timestamp = Math.round(Date.now() / 1000);
    const folder = `bookpro/clinic-photos/${userId}`;
    const apiSecret = this.config.get<string>('cloudinary.apiSecret')!;
    const signature = cloudinary.utils.api_sign_request({ folder, timestamp }, apiSecret);
    return {
      signature,
      timestamp,
      apiKey: this.config.get<string>('cloudinary.apiKey'),
      cloudName: this.config.get<string>('cloudinary.cloudName'),
      folder,
    };
  }

  async saveClinicPhoto(userId: string, url: string) {
    const count = await this.prisma.doctorPhoto.count({ where: { profile_id: userId } });
    if (count >= 9) throw new BadRequestException('Μέγιστος αριθμός φωτογραφιών: 9');

    const agg = await this.prisma.doctorPhoto.aggregate({
      _max: { order: true },
      where: { profile_id: userId },
    });

    return this.prisma.doctorPhoto.create({
      data: { profile_id: userId, url, order: (agg._max.order ?? -1) + 1 },
    });
  }

  async deleteClinicPhoto(userId: string, photoId: string) {
    const photo = await this.prisma.doctorPhoto.findFirst({ where: { id: photoId, profile_id: userId } });
    if (!photo) throw new NotFoundException('Photo not found');

    const match = photo.url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.\w+)?$/);
    if (match?.[1]) await cloudinary.uploader.destroy(match[1]);

    await this.prisma.doctorPhoto.delete({ where: { id: photoId } });
    return { success: true };
  }

  async uploadIdPhoto(userId: string, imageData: string): Promise<{ idPhotoUrl: string }> {
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { user_id: userId },
      select: { verification_status: true },
    });
    if (profile?.verification_status === 'APPROVED' || profile?.verification_status === 'PENDING') {
      throw new ForbiddenException('Identity documents cannot be changed while under review or after approval');
    }

    if (imageData.length > 8 * 1024 * 1024) {
      throw new BadRequestException('Image is too large. Please choose a smaller image.');
    }

    const result = await cloudinary.uploader.upload(imageData, {
      public_id: `bookpro/id-photos/${userId}`,
      overwrite: true,
      invalidate: true,
      resource_type: 'image',
    });

    const baseUrl = result.secure_url.replace(/\?.*$/, '');

    await this.prisma.doctorProfile.update({
      where: { user_id: userId },
      data: { id_photo_url: baseUrl, updated_at: new Date() },
    });

    return { idPhotoUrl: baseUrl };
  }

  async uploadAvatar(userId: string, imageData: string): Promise<{ avatarUrl: string }> {
    if (imageData.length > 8 * 1024 * 1024) {
      throw new BadRequestException('Image is too large. Please choose a smaller image.');
    }

    const result = await cloudinary.uploader.upload(imageData, {
      public_id: `bookpro/avatars/${userId}`,
      overwrite: true,
      invalidate: true,
      resource_type: 'image',
    });

    const baseUrl = result.secure_url.replace(/\?.*$/, '');

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatar_url: baseUrl, updated_at: new Date() },
    });

    return { avatarUrl: baseUrl };
  }

  private sanitize(user: any) {
    const { password, ...safe } = user;
    return safe;
  }
}
