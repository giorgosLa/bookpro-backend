import { IsArray, ValidateNested, IsInt, IsOptional, Min, Max, IsString, IsBoolean, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One open window. Several entries may share the same dayOfWeek (split shift). */
export class ScheduleDayDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiProperty({ example: '09:00' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  startTime: string;

  @ApiProperty({ example: '17:00' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
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

export class AdminUpdateScheduleDto {
  @ApiProperty({ type: [ScheduleDayDto], description: 'Several entries may share a dayOfWeek (split shift).' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  schedule: ScheduleDayDto[];
}
