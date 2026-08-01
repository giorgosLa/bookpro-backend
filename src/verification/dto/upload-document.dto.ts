import { IsDateString, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationDocumentType } from '@prisma/client';

export class UploadDocumentDto {
  @ApiProperty({ enum: VerificationDocumentType })
  @IsEnum(VerificationDocumentType)
  type: VerificationDocumentType;

  @ApiProperty({ description: 'Base64 data URI — image/* or application/pdf' })
  @IsString()
  @Matches(/^data:(image\/(jpeg|jpg|png|webp|heic)|application\/pdf);base64,/, {
    message: 'Επιτρέπονται μόνο εικόνες (JPG, PNG, WEBP, HEIC) και PDF.',
  })
  fileData: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string;

  @ApiPropertyOptional({ description: 'Ημερομηνία λήξης εγγράφου (ISO)' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
