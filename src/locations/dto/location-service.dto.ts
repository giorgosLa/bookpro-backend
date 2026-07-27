import {
  IsString, IsOptional, IsNumber, IsPositive, IsBoolean, IsUUID,
  Min, Max, IsArray, ValidateNested, IsInt, Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddLocationServiceDto {
  @ApiProperty({ example: 'uuid-of-service' })
  @IsUUID()
  serviceId: string;

  @ApiPropertyOptional({ example: 50.0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  priceOverride?: number;

  @ApiPropertyOptional({ example: 45 })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(480)
  durationOverride?: number;
}

export class UpdateLocationServiceDto {
  @ApiPropertyOptional({ example: 50.0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  priceOverride?: number | null;

  @ApiPropertyOptional({ example: 45 })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(480)
  durationOverride?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** One open window. Several entries may share the same dayOfWeek (split shift). */
export class ScheduleItemDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:MM' })
  startTime: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:MM' })
  endTime: string;

  @IsBoolean()
  isEnabled: boolean;

  @ApiPropertyOptional({ example: 30, description: 'Minutes between slot starts. Omit for the 30-min default.' })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  slotIntervalMinutes?: number;
}

export class UpdateLocationScheduleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleItemDto)
  schedule: ScheduleItemDto[];
}

export class CreateLocationBlockedTimeDto {
  @ApiProperty({ example: '2024-08-15' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @ApiProperty({ example: '09:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:MM' })
  startTime: string;

  @ApiProperty({ example: '12:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:MM' })
  endTime: string;

  @ApiPropertyOptional({ example: 'Σεμινάριο' })
  @IsOptional()
  @IsString()
  reason?: string;
}

/** Edits an existing blocked time's hours in place. The date is intentionally immutable —
 *  moving a block to another day is a delete + create, not an edit. */
export class UpdateLocationBlockedTimeDto {
  @ApiProperty({ example: '11:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:MM' })
  startTime: string;

  @ApiProperty({ example: '15:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:MM' })
  endTime: string;

  @ApiPropertyOptional({ example: 'Σεμινάριο' })
  @IsOptional()
  @IsString()
  reason?: string;
}
