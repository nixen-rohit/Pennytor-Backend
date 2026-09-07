import {
  IsString,
  MinLength,
  MaxLength,
  IsEnum,
  IsOptional,
  Matches,
} from 'class-validator';
import { FixedDepositPlanId } from '@prisma/client';

export class VerifyFDPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  password: string;

  @IsEnum(FixedDepositPlanId)
  planId: FixedDepositPlanId;
}

export class CreateFDApplicationDto {
  @IsEnum(FixedDepositPlanId)
  planId: FixedDepositPlanId;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  password: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  @Matches(/^\d{6}$/, { message: 'OTP must be a 6-digit number' })
  otp: string;
}

export class RejectFDApplicationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListFDQueryDto {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
