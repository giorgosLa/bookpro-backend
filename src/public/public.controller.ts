import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PublicService } from './public.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { RescheduleBookingDto } from './dto/reschedule-booking.dto';
import { BatchAvailabilityDto } from './dto/batch-availability.dto';
import { Public } from '@/common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '@/common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Public')
@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('search')
  @ApiOperation({ summary: 'Autocomplete: specialties + doctor names matching query' })
  @ApiQuery({ name: 'q', required: true })
  search(@Query('q') q: string) {
    return this.publicService.search(q);
  }

  @Get('doctors')
  @ApiOperation({ summary: 'List all registered doctors' })
  @ApiQuery({ name: 'specialty', required: false, description: 'Filter by MedicalSpecialty enum value' })
  @ApiQuery({ name: 'location', required: false, description: 'Filter by city/area (ILIKE on address and clinic locations)' })
  getDoctors(@Query('specialty') specialty?: string, @Query('location') location?: string) {
    return this.publicService.getDoctors(specialty, location);
  }

  @Post('doctors/availability-batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch availability dates for multiple doctors — replaces N individual calls' })
  getAvailabilityBatch(@Body() dto: BatchAvailabilityDto) {
    return this.publicService.getAvailabilityBatch(dto.slugs, dto.limit);
  }

  @Get('profile/:slug')
  @ApiOperation({ summary: 'Get public profile by booking URL slug' })
  getProfile(@Param('slug') slug: string) {
    return this.publicService.getProfile(slug);
  }

  @Get('profile/:slug/slots')
  @ApiOperation({ summary: 'Get available time slots for a date' })
  @ApiQuery({ name: 'date', example: '2026-06-15' })
  @ApiQuery({ name: 'duration', example: 30, type: Number })
  @ApiQuery({ name: 'locationId', required: false })
  @ApiQuery({ name: 'excludeId', required: false, description: 'Appointment ID to exclude (used during reschedule so own slot stays available)' })
  async getSlots(
    @Param('slug') slug: string,
    @Query('date') date: string,
    @Query('duration') duration: number,
    @Query('locationId') locationId?: string,
    @Query('excludeId') excludeId?: string,
  ) {
    const profileId = await this.publicService.resolveProfileId(slug);
    return this.publicService.getSlots(profileId, date, Number(duration), excludeId, locationId);
  }

  @Get('profile/:slug/slots-range')
  @ApiOperation({ summary: 'Get available slots for N consecutive dates in one call — for the booking grid' })
  @ApiQuery({ name: 'startDate', example: '2026-06-28' })
  @ApiQuery({ name: 'days', example: 7, type: Number })
  @ApiQuery({ name: 'duration', example: 30, type: Number })
  @ApiQuery({ name: 'locationId', required: false })
  async getSlotsRange(
    @Param('slug') slug: string,
    @Query('startDate') startDate: string,
    @Query('days') days: number,
    @Query('duration') duration: number,
    @Query('locationId') locationId?: string,
  ) {
    const profileId = await this.publicService.resolveProfileId(slug);
    return this.publicService.getSlotsRange(profileId, startDate, Number(days), Number(duration), locationId);
  }

  @Get('profile/:slug/availability-dates')
  @ApiOperation({ summary: 'Get next available dates with first slot — for search results page' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'locationId', required: false })
  async getAvailabilityDates(
    @Param('slug') slug: string,
    @Query('limit') limit?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.publicService.getAvailabilityDates(slug, limit ? Number(limit) : 6, locationId);
  }

  @Get('profile/:slug/availability-dates-all')
  @ApiOperation({ summary: 'Availability dates for ALL of a doctor\'s locations in one call — for search cards' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getAvailabilityDatesAllLocations(
    @Param('slug') slug: string,
    @Query('limit') limit?: string,
  ) {
    return this.publicService.getAvailabilityDatesAllLocations(slug, limit ? Number(limit) : 6);
  }

  @Get('profile/:slug/next-slots')
  @ApiOperation({ summary: 'Get next N available slots for listing page' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getNextSlots(
    @Param('slug') slug: string,
    @Query('limit') limit?: string,
  ) {
    return this.publicService.getNextSlots(slug, limit ? Number(limit) : 3);
  }

  @Get('profile/:slug/nearest-dates')
  @ApiOperation({ summary: 'Find nearest available dates around a base date' })
  @ApiQuery({ name: 'baseDate', example: '2026-06-15' })
  @ApiQuery({ name: 'duration', example: 30, type: Number })
  @ApiQuery({ name: 'profileId', required: false })
  async getNearestDates(
    @Param('slug') slug: string,
    @Query('baseDate') baseDate: string,
    @Query('duration') duration: number,
    @Query('profileId') profileId?: string,
  ) {
    const id = profileId ?? await this.publicService.resolveProfileId(slug);
    return this.publicService.findNearestDates(id, baseDate, Number(duration));
  }

  @Post('bookings')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Create a new booking' })
  createBooking(
    @Body() dto: CreateBookingDto,
    @CurrentUser() user?: { id: string },
  ) {
    return this.publicService.createBooking(dto, user?.id);
  }

  @Get('bookings/:token')
  @ApiOperation({ summary: 'Get booking by management token' })
  getBooking(@Param('token') token: string) {
    return this.publicService.getBookingByToken(token);
  }

  @Post('bookings/:token/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a booking (client self-service)' })
  cancelBooking(@Param('token') token: string) {
    return this.publicService.cancelBooking(token);
  }

  @Post('bookings/:token/reschedule')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reschedule a booking (client self-service)' })
  rescheduleBooking(@Param('token') token: string, @Body() dto: RescheduleBookingDto) {
    return this.publicService.rescheduleBooking(token, dto);
  }
}
