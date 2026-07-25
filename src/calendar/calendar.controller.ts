import { Controller, Get, Delete, Query, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { CalendarService } from './calendar.service';
import { Public } from '@/common/decorators/public.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Calendar')
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('auth-url')
  @ApiOperation({ summary: 'Get the Google Calendar consent URL' })
  authUrl(@CurrentUser() user: { id: string }) {
    return this.calendar.getAuthUrl(user.id);
  }

  @Public()
  @Get('callback')
  @ApiOperation({ summary: 'Google OAuth callback — exchanges code and redirects to the dashboard' })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() reply: FastifyReply,
  ) {
    const redirectTo = await this.calendar.handleCallback(code, state, error);
    // Take over the response so the global TransformInterceptor doesn't reset the
    // status to 200 (which leaves the Location header unfollowed — a white page).
    // Same hijack pattern the SSE events endpoint uses with the Fastify adapter.
    reply.hijack();
    reply.raw.writeHead(302, { Location: redirectTo });
    reply.raw.end();
  }

  @Get('status')
  @ApiOperation({ summary: 'Whether the current doctor has Google Calendar connected' })
  status(@CurrentUser() user: { id: string }) {
    return this.calendar.getStatus(user.id);
  }

  @Delete('disconnect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disconnect Google Calendar' })
  disconnect(@CurrentUser() user: { id: string }) {
    return this.calendar.disconnect(user.id);
  }

  @Get('events')
  @ApiOperation({ summary: 'List the doctor’s Google Calendar events (dashboard overlay)' })
  events(
    @CurrentUser() user: { id: string },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.calendar.getEvents(user.id, from, to);
  }
}
