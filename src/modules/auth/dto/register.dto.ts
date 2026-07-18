import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { IsStrongPassword } from '../../../common/decorators/is-strong-password.decorator';

export class RegisterDto {
  @IsString()
  @Length(1, 50)
  firstName: string;

  @IsString()
  @Length(1, 50)
  lastName: string;

  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email: string;

  @IsString()
  @IsStrongPassword()
  password: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]{8}$/, {
    message: 'Referral code must be 8 uppercase alphanumeric characters',
  })
  referralCode?: string;

  @IsBoolean()
  acceptTerms: boolean;

  @IsOptional()
  @IsBoolean()
  marketingEmails?: boolean = false;
}
