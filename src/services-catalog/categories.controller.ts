import { Controller, Get, Post, Patch, Delete, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Service Categories')
@ApiBearerAuth()
@Controller('services/categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List all categories with their services' })
  findAll(@CurrentUser() user: { id: string }) {
    return this.categoriesService.findAll(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new service category' })
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a service category' })
  update(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a category (services become uncategorized)' })
  remove(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.remove(user.id, id);
  }
}
