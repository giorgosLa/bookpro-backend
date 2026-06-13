import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadClinicPhotoDto {
  @ApiProperty({ description: 'Base64-encoded image (data:image/...;base64,...)' })
  @IsString()
  @Matches(/^data:image\/(jpeg|png|webp);base64,/, {
    message: 'imageData must be a valid base64-encoded image (jpeg, png or webp)',
  })
  imageData: string;
}
