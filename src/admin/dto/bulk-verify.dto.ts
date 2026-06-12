import { IsArray, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BulkVerifyDto {
  @ApiProperty({ type: [String], description: 'Array of doctor user IDs' })
  @IsArray()
  @IsUUID('all', { each: true })
  ids: string[];

  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsEnum(['APPROVED', 'REJECTED'])
  status: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
