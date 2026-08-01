import { IsOptional, IsString, MaxLength, Matches, IsEnum, IsBoolean, IsNumber, Min, Max, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MedicalSpecialty, Gender, BloodType } from '@prisma/client';

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  businessName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional({ example: 'elite-barber' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug may only contain lowercase letters, numbers and hyphens' })
  @MaxLength(100)
  bookingUrlSlug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  bufferMinutes?: number;

  // Doctor profile fields
  @ApiPropertyOptional({ enum: MedicalSpecialty })
  @IsOptional()
  @IsEnum(MedicalSpecialty)
  specialty?: MedicalSpecialty;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  acceptsGessy?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  acceptsEopyy?: boolean;

  @ApiPropertyOptional({ type: Number, example: 37.9838 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ type: Number, example: 23.7275 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ example: 'ΙΣΑ-12345' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  medicalAssociationNumber?: string;

  @ApiPropertyOptional({ example: 'GHS-004512', description: 'Αριθμός παρόχου ΓεΣΥ' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  ghsProviderId?: string;

  @ApiPropertyOptional({ example: '12345678X', description: 'ΑΦΤ Κύπρου (8 ψηφία + γράμμα) ή ελληνικό ΑΦΜ (9 ψηφία)' })
  @IsOptional()
  @IsString()
  // The check letter is optional so the four pre-Cyprus rows that hold a bare
  // 8-digit value can still be saved without a forced edit.
  @Matches(/^(\d{8}[A-Z]?|\d{9})$/, {
    message: 'Το ΑΦΤ έχει 8 ψηφία και ένα γράμμα (π.χ. 12345678X). Το ελληνικό ΑΦΜ έχει 9 ψηφία.',
  })
  afm?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  idPhotoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  termsAccepted?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  doctorPhone?: string;

  @ApiPropertyOptional({ example: 'MD, PhD' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  education?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  doctorGender?: Gender;

  // Patient profile fields
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: '1990-05-15' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(11)
  amka?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  eopyyNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  gessyNumber?: string;

  @ApiPropertyOptional({ enum: BloodType })
  @IsOptional()
  @IsEnum(BloodType)
  bloodType?: BloodType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  allergies?: string;
}
