import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { GoogleCalendarService } from './google-calendar.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
      }),
    }),
  ],
  controllers: [CalendarController],
  providers: [CalendarService, GoogleCalendarService],
  // GoogleCalendarService is consumed by PublicModule (freebusy) and
  // AppointmentsModule (push on status change).
  exports: [GoogleCalendarService],
})
export class CalendarModule {}
