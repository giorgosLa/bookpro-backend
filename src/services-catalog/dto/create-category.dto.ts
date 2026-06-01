import { IsString, IsOptional, IsInt, Min, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Αιματολογικά' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
