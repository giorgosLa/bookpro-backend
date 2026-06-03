import { Controller, Get, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { AdminGuard } from '@/common/guards/admin.guard';
import { VerifyDoctorDto } from './dto/verify-doctor.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Platform overview stats' })
  getStats() {
    return this.adminService.getStats();
  }

  @Get('users')
  @ApiOperation({ summary: 'Search users by name/email' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'role', required: false, description: 'DOCTOR | PATIENT' })
  searchUsers(@Query('q') q?: string, @Query('role') role?: string) {
    return this.adminService.searchUsers(q, role);
  }

  @Get('doctors')
  @ApiOperation({ summary: 'List all doctors with verification status' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by verification status' })
  getDoctors(@Query('status') status?: string) {
    return this.adminService.getDoctors(status);
  }

  @Get('doctors/:id')
  @ApiOperation({ summary: 'Get doctor detail (appointments, services, working hours)' })
  getDoctorDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getDoctorDetail(id);
  }

  @Patch('doctors/:id/verify')
  @ApiOperation({ summary: 'Approve or reject a doctor' })
  verifyDoctor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyDoctorDto,
  ) {
    return this.adminService.verifyDoctor(id, dto);
  }

  @Get('reviews')
  @ApiOperation({ summary: 'List all reviews' })
  getReviews() {
    return this.adminService.getReviews();
  }

  @Patch('reviews/:id/visibility')
  @ApiOperation({ summary: 'Toggle review visibility' })
  toggleReviewVisibility(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.toggleReviewVisibility(id);
  }
}
