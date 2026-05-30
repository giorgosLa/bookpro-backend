import { Controller, Get, Post, Patch, Delete, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ServicesCatalogService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Services')
@ApiBearerAuth()
@Controller('services')
export class ServicesCatalogController {
  constructor(private readonly servicesService: ServicesCatalogService) {}

  @Get()
  @ApiOperation({ summary: 'List all services for authenticated user' })
  findAll(@CurrentUser() user: { id: string }) {
    return this.servicesService.findAll(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new service' })
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateServiceDto) {
    return this.servicesService.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a service' })
  update(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.servicesService.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a service' })
  remove(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string) {
    return this.servicesService.remove(user.id, id);
  }
}
