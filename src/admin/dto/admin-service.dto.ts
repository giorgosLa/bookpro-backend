import { IsString, IsOptional, IsNumber, IsPositive, Min, Max, MaxLength, IsBoolean, IsUUID, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';

export class AdminCreateServiceCategoryDto {
  @ApiProperty({ example: 'Εξετάσεις' })
  @IsString()
  @MaxLength(100)
  name: string;
}

export class AdminCreateServiceDto {
  @ApiProperty({ example: 'Γενική εξέταση' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  price?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  priceMin?: number;

  @ApiPropertyOptional({ example: 80 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  priceMax?: number;

  @ApiProperty({ example: 30 })
  @IsNumber()
  @Min(5)
  @Max(480)
  durationMinutes: number;

  @ApiPropertyOptional({ description: 'Assign to an existing category' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

/** Skips validation for an explicit null, so `null` passes through as "clear this". */
const SkipIfNull = () =>
  ValidateIf((_obj: unknown, value: unknown) => value !== null);

// The price fields are omitted from the base and re-declared as nullable: switching
// a service from a price range back to a fixed price has to CLEAR price_min/price_max,
// and an omitted field leaves the old value in the DB. `null` is the erase signal.
export class AdminUpdateServiceDto extends PartialType(
  OmitType(AdminCreateServiceDto, ['price', 'priceMin', 'priceMax', 'categoryId'] as const),
) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** `null` removes the service from its category. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @SkipIfNull()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @SkipIfNull()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  price?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @SkipIfNull()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  priceMin?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @SkipIfNull()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  priceMax?: number | null;
}

export class AdminAddLocationServiceDto {
  @ApiProperty()
  @IsUUID()
  serviceId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  priceOverride?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(480)
  durationOverride?: number;
}

export class AdminUpdateLocationServiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  priceOverride?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(480)
  durationOverride?: number | null;
}

export class AdminCreateLocationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  lat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  lng?: number;
}

export class AdminUpdateLocationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  lat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  lng?: number;
}
