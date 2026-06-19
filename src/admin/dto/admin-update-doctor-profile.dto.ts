import { IsOptional, IsString, MaxLength, IsEnum, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MedicalSpecialty } from '@prisma/client';

export class AdminUpdateDoctorProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  businessName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional({ example: 'ΙΣΑ-12345' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  medicalAssociationNumber?: string;

  @ApiPropertyOptional({ example: '123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(15)
  afm?: string;

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
}
