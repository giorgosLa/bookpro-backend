import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

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
        booking_url_slug: dto.bookingUrlSlug,
        timezone: dto.timezone,
        buffer_minutes: dto.bufferMinutes,
        updated_at: new Date(),
      },
    });

    return this.sanitize(updated);
  }

  private sanitize(user: any) {
    const { password, ...safe } = user;
    return safe;
  }
}
