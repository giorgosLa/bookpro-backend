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
import { Public } from '@/common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '@/common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Public')
@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('doctors')
  @ApiOperation({ summary: 'List all registered doctors' })
  @ApiQuery({ name: 'specialty', required: false, description: 'Filter by MedicalSpecialty enum value' })
  getDoctors(@Query('specialty') specialty?: string) {
    return this.publicService.getDoctors(specialty);
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
  async getSlots(
    @Param('slug') slug: string,
    @Query('date') date: string,
    @Query('duration') duration: number,
    @Query('locationId') locationId?: string,
  ) {
    const profileId = await this.publicService.resolveProfileId(slug);
    return this.publicService.getSlots(profileId, date, Number(duration), undefined, locationId);
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
