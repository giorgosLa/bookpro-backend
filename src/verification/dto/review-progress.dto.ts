import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewDocumentDto {
  @IsUUID()
  id: string;

  @IsIn(['PENDING', 'ACCEPTED', 'REJECTED'])
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ReviewProgressDto {
  @ApiPropertyOptional({ type: Object, isArray: true })
  @IsOptional()
  checklist?: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  adminNotes?: string;

  @ApiPropertyOptional({ type: ReviewDocumentDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReviewDocumentDto)
  documents?: ReviewDocumentDto[];
}
