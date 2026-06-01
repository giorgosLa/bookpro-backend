import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
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
    const user = await this.prisma.user.findUnique({ where: { id } });
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

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        business_name: dto.businessName,
        full_name: dto.fullName,
        profession: dto.profession,
        bio: dto.bio,
        address: dto.address,
        booking_url_slug: dto.bookingUrlSlug,
        timezone: dto.timezone,
        buffer_minutes: dto.bufferMinutes,
        updated_at: new Date(),
      },
    });

    return this.sanitize(updated);
  }

  async uploadAvatar(userId: string, imageData: string): Promise<{ avatarUrl: string }> {
    // Reject payloads over ~8 MB (base64 of a ~6 MB raw image)
    if (imageData.length > 8 * 1024 * 1024) {
      throw new BadRequestException('Image is too large. Please choose a smaller image.');
    }

    const result = await cloudinary.uploader.upload(imageData, {
      public_id: `bookpro/avatars/${userId}`,
      overwrite: true,
      resource_type: 'image',
      // Face-aware square crop at 400×400, delivered as JPEG
      transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face', format: 'jpg', quality: 'auto:good' }],
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatar_url: result.secure_url, updated_at: new Date() },
    });

    return { avatarUrl: result.secure_url };
  }

  private sanitize(user: any) {
    const { password, ...safe } = user;
    return safe;
  }
}
