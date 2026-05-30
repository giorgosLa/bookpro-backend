import { Controller, Post, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { Public } from '@/common/decorators/public.decorator';

@ApiTags('Webhooks')
@Public()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('google-calendar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Google Calendar push notification receiver' })
  handleGoogleCalendar(@Headers() headers: Record<string, string>) {
    return this.webhooksService.handleGoogleCalendarPush(headers);
  }
}
