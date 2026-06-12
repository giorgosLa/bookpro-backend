import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { LocationsService } from './locations.service';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { CreateLocationDto, UpdateLocationDto } from './dto/create-location.dto';
import {
  AddLocationServiceDto,
  UpdateLocationServiceDto,
  UpdateLocationScheduleDto,
  CreateLocationBlockedTimeDto,
} from './dto/location-service.dto';

@ApiTags('locations')
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  // ── Location CRUD ──────────────────────────────────────────────────────────

  @Get()
  findAll(@CurrentUser() user: { id: string }) {
    return this.locationsService.findAll(user.id);
  }

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateLocationDto) {
    return this.locationsService.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locationsService.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.locationsService.remove(user.id, id);
  }

  // ── Per-location schedule ──────────────────────────────────────────────────

  @Get(':id/schedule')
  getSchedule(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.locationsService.getSchedule(user.id, id);
  }

  @Post(':id/schedule')
  updateSchedule(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateLocationScheduleDto,
  ) {
    return this.locationsService.updateSchedule(user.id, id, dto);
  }

  // ── Per-location blocked time ──────────────────────────────────────────────

  @Get(':id/blocked')
  getBlockedTimes(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.locationsService.getBlockedTimes(user.id, id);
  }

  @Post(':id/blocked')
  createBlockedTime(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: CreateLocationBlockedTimeDto,
  ) {
    return this.locationsService.createBlockedTime(user.id, id, dto);
  }

  @Delete(':id/blocked/:blockedId')
  @HttpCode(HttpStatus.OK)
  deleteBlockedTime(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('blockedId') blockedId: string,
  ) {
    return this.locationsService.deleteBlockedTime(user.id, id, blockedId);
  }

  // ── Location services (pivot) ──────────────────────────────────────────────

  @Get(':id/services')
  getServices(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.locationsService.getServices(user.id, id);
  }

  @Post(':id/services')
  addService(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: AddLocationServiceDto,
  ) {
    return this.locationsService.addService(user.id, id, dto);
  }

  @Patch(':id/services/:serviceId')
  updateService(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('serviceId') serviceId: string,
    @Body() dto: UpdateLocationServiceDto,
  ) {
    return this.locationsService.updateService(user.id, id, serviceId, dto);
  }

  @Delete(':id/services/:serviceId')
  @HttpCode(HttpStatus.OK)
  removeService(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('serviceId') serviceId: string,
  ) {
    return this.locationsService.removeService(user.id, id, serviceId);
  }
}
