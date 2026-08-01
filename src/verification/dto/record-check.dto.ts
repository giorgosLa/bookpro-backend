import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecordCheckDto {
  @ApiProperty({ enum: ['PHONE', 'REGISTRY'] })
  @IsIn(['PHONE', 'REGISTRY'])
  kind: 'PHONE' | 'REGISTRY';

  @ApiPropertyOptional({ description: 'Ο αριθμός που κλήθηκε (kind=PHONE)' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  number?: string;

  @ApiPropertyOptional({ description: 'Πηγή μητρώου (kind=REGISTRY)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({ description: 'false = ανακαλεί τον έλεγχο' })
  @IsOptional()
  @IsBoolean()
  cleared?: boolean;
}
