import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SIPPlanId } from '@prisma/client';

export class VerifyPasswordDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  password: string;

  @IsNotEmpty()
  @IsEnum(SIPPlanId)
  scheme: SIPPlanId;

  @IsOptional()
  @IsNumberString()
  @MaxLength(15)
  amount?: string;
}

export class CreateSIPForChildApplicationDto {
  @IsNotEmpty()
  @IsEnum(SIPPlanId)
  scheme: SIPPlanId;

  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  password: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  otp: string;
}

export class PayPremiumDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  password: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  otp: string;
}

export class ListSIPForChildQueryDto {
  @IsOptional()
  @IsString()
  page: string = '1';

  @IsOptional()
  @IsString()
  pageSize: string = '20';

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class UpdateSIPForChildStatusDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
