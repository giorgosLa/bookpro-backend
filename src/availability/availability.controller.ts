import { Controller, Get, Put, Post, Delete, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AvailabilityService } from './availability.service';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { CreateBlockedTimeDto } from './dto/blocked-time.dto';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Availability')
@ApiBearerAuth()
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get('schedule')
  @ApiOperation({ summary: 'Get working hours schedule' })
  getSchedule(@CurrentUser() user: { id: string }) {
    return this.availabilityService.getSchedule(user.id);
  }

  @Put('schedule')
  @ApiOperation({ summary: 'Replace working hours schedule' })
  updateSchedule(@CurrentUser() user: { id: string }, @Body() dto: UpdateAvailabilityDto) {
    return this.availabilityService.updateSchedule(user.id, dto);
  }

  @Get('blocked')
  @ApiOperation({ summary: 'List blocked time slots' })
  getBlocked(@CurrentUser() user: { id: string }) {
    return this.availabilityService.getBlockedTimes(user.id);
  }

  @Post('blocked')
  @ApiOperation({ summary: 'Add a blocked time slot' })
  createBlocked(@CurrentUser() user: { id: string }, @Body() dto: CreateBlockedTimeDto) {
    return this.availabilityService.createBlockedTime(user.id, dto);
  }

  @Delete('blocked/:id')
  @ApiOperation({ summary: 'Remove a blocked time slot' })
  deleteBlocked(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string) {
    return this.availabilityService.deleteBlockedTime(user.id, id);
  }
}
