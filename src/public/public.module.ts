import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { EventsModule } from '@/events/events.module';
import { CalendarModule } from '@/calendar/calendar.module';

@Module({
  imports: [EventsModule, CalendarModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
