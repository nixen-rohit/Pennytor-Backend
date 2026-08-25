import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { InvestmentScheme } from '../investment-fund.types';

export class CreateInvestmentApplicationDto {
  @IsNotEmpty()
  @IsEnum(InvestmentScheme)
  scheme: InvestmentScheme;

  @IsNotEmpty()
  @IsString()
  @IsNumberString()
  @MinLength(1)
  @MaxLength(15)
  amount: string;

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

export class VerifyPasswordDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  password: string;

  @IsNotEmpty()
  @IsEnum(InvestmentScheme)
  scheme: InvestmentScheme;

  // The amount the user is actually applying with — echoed in the OTP email.
  @IsOptional()
  @IsNumberString()
  @MaxLength(15)
  amount?: string;
}

export class ListInvestmentApplicationsQueryDto {
  @IsNotEmpty()
  @IsString()
  page: string = '1';

  @IsNotEmpty()
  @IsString()
  pageSize: string = '20';
}
