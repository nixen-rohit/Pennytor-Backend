import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsStrongPassword } from '../../../common/decorators/is-strong-password.decorator';

export class RegisterDto {
  @ApiProperty({
    description: 'User first name',
    example: 'John',
    minLength: 1,
    maxLength: 50,
  })
  @IsString()
  @Length(1, 50)
  firstName: string;

  @ApiProperty({
    description: 'User last name',
    example: 'Doe',
    minLength: 1,
    maxLength: 50,
  })
  @IsString()
  @Length(1, 50)
  lastName: string;

  @ApiProperty({
    description: 'User email address (will be normalized to lowercase)',
    example: 'john.doe@example.com',
    maxLength: 255,
  })
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @ApiProperty({
    description:
      'Password — min 8 characters with at least 1 uppercase, 1 lowercase, 1 digit, and 1 special character',
    example: 'SecureP@ss1',
    minLength: 8,
  })
  @IsString()
  @IsStrongPassword()
  password: string;

  @ApiPropertyOptional({
    description: '8-character uppercase alphanumeric referral code',
    example: 'ABC12345',
    pattern: '^[A-Z0-9]{8}$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]{8}$/, {
    message: 'Referral code must be 8 uppercase alphanumeric characters',
  })
  referralCode?: string;

  @ApiProperty({
    description: 'Must be true to accept the terms and conditions',
    example: true,
  })
  @IsBoolean()
  @IsIn([true], { message: 'You must accept the terms and conditions to register' })
  acceptTerms: boolean;

  @ApiPropertyOptional({
    description: 'Opt-in to marketing emails',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  marketingEmails?: boolean = false;
}
