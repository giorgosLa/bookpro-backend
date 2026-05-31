import { Controller, Get, Patch, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AppointmentsService } from './appointments.service';
import { UpdateStatusDto } from './dto/update-status.dto';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Appointments')
@ApiBearerAuth()
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List all appointments for authenticated user' })
  findAll(@CurrentUser() user: { id: string }) {
    return this.appointmentsService.findAll(user.id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update appointment status' })
  updateStatus(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.appointmentsService.updateStatus(user.id, id, dto);
  }
}
