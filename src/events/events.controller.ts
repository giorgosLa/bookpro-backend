import { Controller, Get, Res, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { EventsService } from './events.service';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Events')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  /**
   * SSE endpoint for real-time appointment notifications.
   *
   * Uses manual SSE via reply.raw because @Sse() is not compatible with
   * @nestjs/platform-fastify. The JWT is passed as ?token= query param because
   * EventSource cannot set custom headers.
   */
  @Get('stream')
  @ApiOperation({ summary: 'SSE stream — real-time appointment notifications' })
  @ApiQuery({ name: 'token', required: true, description: 'JWT access token' })
  stream(
    @CurrentUser() user: { id: string },
    @Res() reply: any,
    @Req() request: any,
  ) {
    // Hijack the Fastify reply so it doesn't try to send its own response.
    // Must be called before flushHeaders so CORS headers set by Fastify hooks
    // are still on reply.getHeaders().
    const existingHeaders = reply.getHeaders();
    reply.hijack();

    const raw = reply.raw;

    // Copy headers already set by NestJS/Fastify hooks (CORS etc.)
    for (const [key, value] of Object.entries(existingHeaders)) {
      if (value !== undefined) raw.setHeader(key, value as any);
    }

    // SSE-specific headers
    raw.setHeader('Content-Type', 'text/event-stream');
    raw.setHeader('Cache-Control', 'no-cache, no-transform');
    raw.setHeader('Connection', 'keep-alive');
    raw.setHeader('X-Accel-Buffering', 'no'); // Prevent nginx / proxy buffering

    raw.flushHeaders();
    raw.write('retry: 3000\n\n'); // Client reconnect delay

    // Subscribe to appointment events for this doctor
    const sub = this.eventsService.getStream(user.id).subscribe({
      next: (data: any) => {
        try {
          raw.write(`event: new_appointment\ndata: ${JSON.stringify(data)}\n\n`);
        } catch {
          clearInterval(ping);
          sub.unsubscribe();
        }
      },
    });

    // Keep-alive ping every 25s (prevents proxies from closing idle connections)
    const ping = setInterval(() => {
      try {
        raw.write(': ping\n\n');
      } catch {
        clearInterval(ping);
        sub.unsubscribe();
      }
    }, 25_000);

    // Cleanup on client disconnect
    request.raw.on('close', () => {
      clearInterval(ping);
      sub.unsubscribe();
      this.eventsService.cleanup(user.id);
    });
  }
}
