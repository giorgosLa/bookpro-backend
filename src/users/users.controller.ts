import { Controller, Get, Patch, Post, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UploadAvatarDto } from './dto/upload-avatar.dto';
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
}
