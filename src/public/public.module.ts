import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { EventsModule } from '@/events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
