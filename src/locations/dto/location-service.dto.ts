import {
  IsString, IsOptional, IsNumber, IsPositive, IsBoolean, IsUUID,
  Min, Max, IsArray, ValidateNested, IsInt,
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

export class ScheduleItemDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @IsString()
  startTime: string;

  @IsString()
  endTime: string;

  @IsBoolean()
  isEnabled: boolean;
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
  date: string;

  @ApiProperty({ example: '09:00' })
  @IsString()
  startTime: string;

  @ApiProperty({ example: '12:00' })
  @IsString()
  endTime: string;

  @ApiPropertyOptional({ example: 'Σεμινάριο' })
  @IsOptional()
  @IsString()
  reason?: string;
}
