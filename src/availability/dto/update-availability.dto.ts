import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One open window. Several entries may share the same dayOfWeek (split shift). */
export class WorkingHourDto {
  @ApiProperty({ example: 1, description: '0=Sun, 1=Mon … 6=Sat' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiProperty({ example: '09:00' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'startTime must be HH:MM' })
  startTime: string;

  @ApiProperty({ example: '18:00' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'endTime must be HH:MM' })
  endTime: string;

  @ApiProperty()
  @IsBoolean()
  isEnabled: boolean;

  @ApiPropertyOptional({ example: 30, description: 'Minutes between slot starts. Omit for the 30-min default.' })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  slotIntervalMinutes?: number;
}

export class UpdateAvailabilityDto {
  @ApiProperty({ type: [WorkingHourDto], description: 'Several entries may share a dayOfWeek (split shift).' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkingHourDto)
  schedule: WorkingHourDto[];
}
