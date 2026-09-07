import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ValidateReferralCodeDto {
  @ApiProperty({
    description: '8-character uppercase alphanumeric referral code',
    example: 'ABC12345',
    pattern: '^[A-Z0-9]{8}$',
  })
  @IsString()
  @Matches(/^[A-Z0-9]{8}$/, {
    message: 'Referral code must be 8 uppercase alphanumeric characters',
  })
  code: string;
}

export class ReferralListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: 'Search by name or email' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive', 'all'], default: 'all' })
  @IsOptional()
  @IsString()
  status?: 'active' | 'inactive' | 'all' = 'all';
}

export class AdminToggleEligibilityDto {
  @ApiProperty({ description: 'Whether the user is eligible for referrals' })
  @IsBoolean()
  eligible: boolean;
}

export class AdminReferralUsersQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({
    description: 'Search by name, email, or referral code',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: ['pennytor_user', 'super_user', 'all'],
    default: 'all',
  })
  @IsOptional()
  @IsString()
  userType?: 'pennytor_user' | 'super_user' | 'all' = 'all';
}
