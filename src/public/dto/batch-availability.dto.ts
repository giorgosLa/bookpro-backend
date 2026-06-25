import { IsArray, IsString, ArrayMaxSize, IsOptional, IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BatchAvailabilityDto {
  @ApiProperty({ type: [String], description: 'Array of doctor booking URL slugs', maxItems: 100 })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(100)
  slugs: string[];

  @ApiProperty({ required: false, default: 6 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}
