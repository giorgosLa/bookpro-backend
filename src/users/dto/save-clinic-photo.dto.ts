import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SaveClinicPhotoDto {
  @ApiProperty({ description: 'Cloudinary secure_url returned after direct upload' })
  @IsString()
  @Matches(/^https:\/\/res\.cloudinary\.com\//, { message: 'url must be a Cloudinary URL' })
  url: string;
}
