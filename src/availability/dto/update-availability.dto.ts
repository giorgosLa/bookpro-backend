import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
}

export class UpdateAvailabilityDto {
  @ApiProperty({ type: [WorkingHourDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkingHourDto)
  schedule: WorkingHourDto[];
}
