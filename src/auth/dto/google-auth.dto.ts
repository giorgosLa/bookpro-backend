import { IsString, IsNotEmpty, IsEnum, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class GoogleAuthDto {
  @ApiProperty({ description: 'Google ID token (JWT credential) from Google Sign-In' })
  @IsString()
  @IsNotEmpty()
  idToken: string;

  // ADMIN is deliberately excluded — the role is client-supplied, and admin
  // accounts are only ever created by setting role = ADMIN directly in the DB.
  @ApiPropertyOptional({ enum: [UserRole.DOCTOR, UserRole.PATIENT], default: UserRole.DOCTOR })
  @IsOptional()
  @IsEnum(UserRole)
  @IsIn([UserRole.DOCTOR, UserRole.PATIENT])
  role?: UserRole;
}
