import { IsOptional, IsString, IsArray, ValidateNested, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ChecklistItemDto {
  @IsString()
  id: string;

  @IsString()
  label: string;

  @IsBoolean()
  checked: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AdminVerificationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  adminNotes?: string;

  @ApiPropertyOptional({ type: [ChecklistItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  checklist?: ChecklistItemDto[];
}
