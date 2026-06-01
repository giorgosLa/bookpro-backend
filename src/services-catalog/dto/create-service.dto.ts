import { IsString, IsOptional, IsNumber, IsPositive, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateServiceDto {
  @ApiProperty({ example: 'Haircut' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Classic haircut and styling' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 25.0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  price?: number;

  @ApiProperty({ example: 30 })
  @IsNumber()
  @Min(5)
  @Max(480)
  durationMinutes: number;

  @ApiPropertyOptional({ example: 'uuid-of-category' })
  @IsOptional()
  @IsString()
  categoryId?: string;
}
