import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ServicesCatalogService {
  constructor(private prisma: PrismaService) {}

  /** Returns all services belonging to a doctor, ordered by creation date. */
  findAll(userId: string) {
    return this.prisma.services.findMany({
      where: { profile_id: userId },
      orderBy: { created_at: 'asc' },
    });
  }

  /** Creates a new bookable service for the authenticated doctor. */
  create(userId: string, dto: CreateServiceDto) {
    return this.prisma.services.create({
      data: {
        id: uuidv4(),
        profile_id: userId,
        name: dto.name,
        description: dto.description ?? null,
        price: dto.price ?? null,
        duration_minutes: dto.durationMinutes,
      },
    });
  }

  /** Updates a service after verifying the doctor owns it. */
  async update(userId: string, serviceId: string, dto: UpdateServiceDto) {
    await this.assertOwnership(userId, serviceId);
    return this.prisma.services.update({
      where: { id: serviceId },
      data: {
        name: dto.name,
        description: dto.description,
        price: dto.price ?? null,
        duration_minutes: dto.durationMinutes,
        is_active: dto.isActive,
        updated_at: new Date(),
      },
    });
  }

  /** Deletes a service after verifying the doctor owns it. */
  async remove(userId: string, serviceId: string) {
    await this.assertOwnership(userId, serviceId);
    await this.prisma.services.delete({ where: { id: serviceId } });
    return { message: 'Service deleted' };
  }

  /** Throws NotFoundException or ForbiddenException if the service doesn't belong to the user. */
  private async assertOwnership(userId: string, serviceId: string) {
    const service = await this.prisma.services.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('Service not found');
    if (service.profile_id !== userId) throw new ForbiddenException();
  }
}
