import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationStatus } from '@prisma/client';

const DECIDABLE = ['APPROVED', 'REJECTED', 'NEEDS_MORE_INFO', 'REVOKED'] as const;

export type DecidableStatus = (typeof DECIDABLE)[number];

export class DecideVerificationDto {
  @ApiProperty({ enum: DECIDABLE })
  @IsIn(DECIDABLE as unknown as string[])
  status: Extract<VerificationStatus, DecidableStatus>;

  @ApiPropertyOptional({ description: 'Υποχρεωτικό για κάθε απόφαση εκτός της έγκρισης' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({ type: Object, isArray: true })
  @IsOptional()
  checklist?: unknown;

  @ApiPropertyOptional({ description: 'Default true — διαγράφει τα αρχεία μετά την έγκριση' })
  @IsOptional()
  @IsBoolean()
  purgeDocuments?: boolean;
}
