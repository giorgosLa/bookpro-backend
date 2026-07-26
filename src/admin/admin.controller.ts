import { Controller, Get, Patch, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors, ParseUUIDPipe, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { AdminGuard } from '@/common/guards/admin.guard';
import { VerifyDoctorDto } from './dto/verify-doctor.dto';
import { AdminUpdateDoctorProfileDto } from './dto/admin-update-doctor-profile.dto';
import { AdminUpdateScheduleDto } from './dto/admin-update-schedule.dto';
import { AdminCreateServiceCategoryDto, AdminCreateServiceDto, AdminUpdateServiceDto, AdminUpdateLocationDto, AdminCreateLocationDto, AdminAddLocationServiceDto, AdminUpdateLocationServiceDto } from './dto/admin-service.dto';
import { AdminAppointmentsQueryDto } from './dto/admin-appointments-query.dto';
import { BulkVerifyDto } from './dto/bulk-verify.dto';
import { AdminVerificationDto } from './dto/admin-verification.dto';
import { AuditInterceptor } from './audit.interceptor';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
// Controller-wide: every state-changing handler here is recorded, including ones
// added later. GET requests pass straight through.
@UseInterceptors(AuditInterceptor)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('audit')
  @ApiOperation({ summary: 'Admin action history (who did what, to whom, when)' })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'targetId', required: false })
  @ApiQuery({ name: 'page', required: false })
  getAuditLog(
    @Query('action') action?: string,
    @Query('targetId') targetId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
  ) {
    return this.adminService.getAuditLog({ action, targetId, page });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Platform overview stats' })
  getStats() {
    return this.adminService.getStats();
  }

  @Get('appointments')
  @ApiOperation({ summary: 'List all platform appointments with filters and pagination' })
  getAppointments(@Query() dto: AdminAppointmentsQueryDto) {
    return this.adminService.getAdminAppointments(dto);
  }

  @Patch('appointments/:id/status')
  @ApiOperation({ summary: 'Cancel or force-complete any appointment (admin override)' })
  updateAppointmentStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: string },
  ) {
    return this.adminService.updateAdminAppointmentStatus(id, body.status);
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Platform-wide analytics (revenue, bookings, user growth, top doctors)' })
  @ApiQuery({ name: 'days', required: false, description: '30 or 90', example: 30 })
  getAnalytics(
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    const safeDays = [30, 90].includes(days) ? days : 30;
    return this.adminService.getAdminAnalytics(safeDays);
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

  // Must stay above `doctors/:id` — otherwise Nest matches the param route first
  // and ParseUUIDPipe rejects the literal "bookability" with a 400.
  @Get('doctors/bookability')
  @ApiOperation({ summary: 'Approved doctors that cannot receive bookings, with the blocking reasons' })
  getDoctorBookability() {
    return this.adminService.getDoctorBookability();
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

  @Patch('users/:id/suspend')
  @ApiOperation({ summary: 'Suspend or unsuspend a user' })
  suspendUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { suspend: boolean },
  ) {
    return this.adminService.suspendUser(id, body.suspend);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Permanently delete a user and all their data' })
  deleteUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.deleteUser(id);
  }

  @Post('doctors/bulk-verify')
  @ApiOperation({ summary: 'Approve or reject multiple doctors at once (sends emails)' })
  bulkVerifyDoctors(@Body() dto: BulkVerifyDto) {
    return this.adminService.bulkVerifyDoctors(dto);
  }

  @Patch('doctors/:id/verification')
  @ApiOperation({ summary: 'Save admin checklist + notes for doctor verification' })
  updateDoctorVerification(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminVerificationDto,
  ) {
    return this.adminService.updateDoctorVerification(id, dto);
  }

  @Patch('doctors/:id/profile')
  @ApiOperation({ summary: 'Update doctor profile fields (name, specialty, bio, address, license, gessy/eopyy)' })
  updateDoctorProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateDoctorProfileDto,
  ) {
    return this.adminService.updateDoctorProfile(id, dto);
  }

  @Put('doctors/:id/schedule')
  @ApiOperation({ summary: 'Replace doctor working hours schedule' })
  updateDoctorSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateScheduleDto,
  ) {
    return this.adminService.updateDoctorSchedule(id, dto);
  }

  @Post('doctors/:id/service-categories')
  @ApiOperation({ summary: 'Create a service category for a doctor' })
  createDoctorServiceCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCreateServiceCategoryDto,
  ) {
    return this.adminService.createDoctorServiceCategory(id, dto);
  }

  @Post('doctors/:id/services')
  @ApiOperation({ summary: 'Add a service to a doctor' })
  createDoctorService(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCreateServiceDto,
  ) {
    return this.adminService.createDoctorService(id, dto);
  }

  @Patch('doctors/:id/services/:serviceId')
  @ApiOperation({ summary: 'Update a doctor service' })
  updateDoctorService(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: AdminUpdateServiceDto,
  ) {
    return this.adminService.updateDoctorService(id, serviceId, dto);
  }

  @Delete('doctors/:id/services/:serviceId')
  @ApiOperation({ summary: 'Delete a doctor service' })
  deleteDoctorService(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
  ) {
    return this.adminService.deleteDoctorService(id, serviceId);
  }

  @Delete('doctors/:id/service-categories/:categoryId')
  @ApiOperation({ summary: 'Delete a service category (services lose their category link)' })
  deleteDoctorServiceCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    return this.adminService.deleteDoctorServiceCategory(id, categoryId);
  }

  @Post('doctors/:id/locations')
  @ApiOperation({ summary: 'Create a new clinic location for a doctor' })
  createDoctorLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCreateLocationDto,
  ) {
    return this.adminService.createDoctorLocation(id, dto);
  }

  @Delete('doctors/:id/locations/:locationId')
  @ApiOperation({ summary: 'Delete a clinic location' })
  deleteDoctorLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
  ) {
    return this.adminService.deleteDoctorLocation(id, locationId);
  }

  @Patch('doctors/:id/locations/:locationId')
  @ApiOperation({ summary: 'Update a location (name, address, phone, isActive)' })
  updateDoctorLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() dto: AdminUpdateLocationDto,
  ) {
    return this.adminService.updateDoctorLocation(id, locationId, dto);
  }

  @Post('doctors/:id/locations/:locationId/services')
  @ApiOperation({ summary: 'Add a service to a location (with optional price/duration override)' })
  addLocationService(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() dto: AdminAddLocationServiceDto,
  ) {
    return this.adminService.addLocationService(id, locationId, dto);
  }

  @Patch('doctors/:id/locations/:locationId/services/:locServiceId')
  @ApiOperation({ summary: 'Update location-service overrides (price, duration)' })
  updateLocationService(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Param('locServiceId', ParseUUIDPipe) locServiceId: string,
    @Body() dto: AdminUpdateLocationServiceDto,
  ) {
    return this.adminService.updateLocationService(id, locationId, locServiceId, dto);
  }

  @Delete('doctors/:id/locations/:locationId/services/:locServiceId')
  @ApiOperation({ summary: 'Remove a service from a location' })
  removeLocationService(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Param('locServiceId', ParseUUIDPipe) locServiceId: string,
  ) {
    return this.adminService.removeLocationService(id, locationId, locServiceId);
  }

  @Post('doctors/:id/locations/:locationId/schedule')
  @ApiOperation({ summary: 'Replace working hours for a specific clinic location' })
  updateDoctorLocationSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() dto: AdminUpdateScheduleDto,
  ) {
    return this.adminService.updateDoctorLocationSchedule(id, locationId, dto);
  }
}
