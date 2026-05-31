import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PublicService } from './public.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { RescheduleBookingDto } from './dto/reschedule-booking.dto';
import { Public } from '@/common/decorators/public.decorator';

@ApiTags('Public')
@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('doctors')
  @ApiOperation({ summary: 'List all registered doctors' })
  @ApiQuery({ name: 'profession', required: false })
  getDoctors(@Query('profession') profession?: string) {
    return this.publicService.getDoctors(profession);
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
  async getSlots(
    @Param('slug') slug: string,
    @Query('date') date: string,
    @Query('duration') duration: number,
  ) {
    const profileId = await this.publicService.resolveProfileId(slug);
    return this.publicService.getSlots(profileId, date, Number(duration));
  }

  @Get('profile/:slug/nearest-dates')
  @ApiOperation({ summary: 'Find nearest available dates around a base date' })
  @ApiQuery({ name: 'baseDate', example: '2026-06-15' })
  @ApiQuery({ name: 'duration', example: 30, type: Number })
  async getNearestDates(
    @Param('slug') slug: string,
    @Query('baseDate') baseDate: string,
    @Query('duration') duration: number,
  ) {
    const profileId = await this.publicService.resolveProfileId(slug);
    return this.publicService.findNearestDates(profileId, baseDate, Number(duration));
  }

  @Post('bookings')
  @ApiOperation({ summary: 'Create a new booking' })
  createBooking(@Body() dto: CreateBookingDto) {
    return this.publicService.createBooking(dto);
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
