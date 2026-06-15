import { Controller, Get, Patch, Post, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UploadAvatarDto } from './dto/upload-avatar.dto';
import { SaveClinicPhotoDto } from './dto/save-clinic-photo.dto';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@CurrentUser() user: { id: string }) {
    return this.usersService.findById(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  updateMe(@CurrentUser() user: { id: string }, @Body() dto: UpdateProfileDto) {
    return this.usersService.update(user.id, dto);
  }

  @Post('me/resubmit')
  @ApiOperation({ summary: 'Re-submit doctor profile for verification after rejection' })
  resubmit(@CurrentUser() user: { id: string }) {
    return this.usersService.resubmitVerification(user.id);
  }

  @Post('me/avatar')
  @ApiOperation({ summary: 'Upload avatar photo (base64) — stored on Cloudinary' })
  uploadAvatar(@CurrentUser() user: { id: string }, @Body() dto: UploadAvatarDto) {
    return this.usersService.uploadAvatar(user.id, dto.imageData);
  }

  @Post('me/id-photo')
  @ApiOperation({ summary: 'Upload ID photo (base64) — stored on Cloudinary' })
  uploadIdPhoto(@CurrentUser() user: { id: string }, @Body() dto: UploadAvatarDto) {
    return this.usersService.uploadIdPhoto(user.id, dto.imageData);
  }

  @Get('me/photos')
  @ApiOperation({ summary: 'List clinic photos for authenticated doctor' })
  getClinicPhotos(@CurrentUser() user: { id: string }) {
    return this.usersService.getClinicPhotos(user.id);
  }

  @Get('me/photos/signature')
  @ApiOperation({ summary: 'Get Cloudinary signed upload params for direct browser upload' })
  getUploadSignature(@CurrentUser() user: { id: string }) {
    return this.usersService.getUploadSignature(user.id);
  }

  @Post('me/photos/save')
  @ApiOperation({ summary: 'Save clinic photo URL after direct Cloudinary upload (max 9)' })
  saveClinicPhoto(@CurrentUser() user: { id: string }, @Body() dto: SaveClinicPhotoDto) {
    return this.usersService.saveClinicPhoto(user.id, dto.url);
  }

  @Delete('me/photos/:id')
  @ApiOperation({ summary: 'Delete a clinic photo by id' })
  deleteClinicPhoto(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.usersService.deleteClinicPhoto(user.id, id);
  }
}
