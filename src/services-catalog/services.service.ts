import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { v4 as uuidv4 } from 'uuid';

const categorySelect = { select: { id: true, name: true } };

@Injectable()
export class ServicesCatalogService {
  constructor(private prisma: PrismaService) {}

  findAll(userId: string) {
    return this.prisma.services.findMany({
      where: { profile_id: userId },
      include: { service_category: categorySelect },
      orderBy: { created_at: 'asc' },
    });
  }

  create(userId: string, dto: CreateServiceDto) {
    return this.prisma.services.create({
      data: {
        id: uuidv4(),
        profile_id: userId,
        name: dto.name,
        description: dto.description ?? null,
        price: dto.price ?? null,
        price_min: dto.priceMin ?? null,
        price_max: dto.priceMax ?? null,
        duration_minutes: dto.durationMinutes,
        category_id: dto.categoryId ?? null,
      },
      include: { service_category: categorySelect },
    });
  }

  async update(userId: string, serviceId: string, dto: UpdateServiceDto) {
    await this.assertOwnership(userId, serviceId);
    return this.prisma.services.update({
      where: { id: serviceId },
      data: {
        name: dto.name,
        description: dto.description,
        price: dto.price !== undefined ? (dto.price ?? null) : undefined,
        price_min: dto.priceMin !== undefined ? (dto.priceMin ?? null) : undefined,
        price_max: dto.priceMax !== undefined ? (dto.priceMax ?? null) : undefined,
        duration_minutes: dto.durationMinutes,
        is_active: dto.isActive,
        category_id: dto.categoryId !== undefined ? (dto.categoryId ?? null) : undefined,
        updated_at: new Date(),
      },
      include: { service_category: categorySelect },
    });
  }

  async remove(userId: string, serviceId: string) {
    await this.assertOwnership(userId, serviceId);
    await this.prisma.services.delete({ where: { id: serviceId } });
    return { message: 'Service deleted' };
  }

  private async assertOwnership(userId: string, serviceId: string) {
    const service = await this.prisma.services.findUnique({
      where: { id: serviceId },
      select: { profile_id: true },
    });
    if (!service) throw new NotFoundException('Service not found');
    if (service.profile_id !== userId) throw new ForbiddenException();
  }
}
