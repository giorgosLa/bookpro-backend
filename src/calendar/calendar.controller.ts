import { Controller, Get, Delete, Query, Redirect, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CalendarService } from './calendar.service';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Calendar')
@ApiBearerAuth()
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get('auth-url')
  @ApiOperation({ summary: 'Get Google OAuth consent URL' })
  getAuthUrl() {
    return { url: this.calendarService.getAuthUrl() };
  }

  @Get('callback')
  @ApiOperation({ summary: 'Google OAuth callback (redirect from Google)' })
  async callback(
    @Query('code') code: string,
    @Query('state') userId: string,
  ) {
    await this.calendarService.handleCallback(code, userId);
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    return { url: `${appUrl}/dashboard/profile?calendar=connected` };
  }

  @Delete('disconnect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disconnect Google Calendar' })
  disconnect(@CurrentUser() user: { id: string }) {
    return this.calendarService.disconnect(user.id);
  }

  @Get('events')
  @ApiOperation({ summary: 'List upcoming Google Calendar events' })
  getEvents(@CurrentUser() user: { id: string }) {
    return this.calendarService.getEvents(user.id);
  }
}
