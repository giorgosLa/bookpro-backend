import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  findAll(userId: string) {
    return this.prisma.service_categories.findMany({
      where: { profile_id: userId },
      include: {
        services: {
          orderBy: { created_at: 'asc' },
        },
      },
      orderBy: [{ order: 'asc' }, { created_at: 'asc' }],
    });
  }

  create(userId: string, dto: CreateCategoryDto) {
    return this.prisma.service_categories.create({
      data: {
        id: uuidv4(),
        profile_id: userId,
        name: dto.name,
        order: dto.order ?? 0,
      },
      include: { services: true },
    });
  }

  async update(userId: string, id: string, dto: UpdateCategoryDto) {
    await this.assertOwnership(userId, id);
    return this.prisma.service_categories.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
      include: { services: true },
    });
  }

  async remove(userId: string, id: string) {
    await this.assertOwnership(userId, id);
    await this.prisma.service_categories.delete({ where: { id } });
    return { message: 'Category deleted' };
  }

  private async assertOwnership(userId: string, id: string) {
    const cat = await this.prisma.service_categories.findUnique({
      where: { id },
      select: { profile_id: true },
    });
    if (!cat) throw new NotFoundException('Category not found');
    if (cat.profile_id !== userId) throw new ForbiddenException();
  }
}
