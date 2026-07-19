import { IsEmail, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsStrongPassword } from '../../../common/decorators/is-strong-password.decorator';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Email address associated with the account',
    example: 'john.doe@example.com',
  })
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @ApiProperty({
    description: 'Password reset token from the email link',
    example: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    minLength: 64,
    maxLength: 64,
  })
  @IsString()
  @Length(64, 64)
  token: string;

  @ApiProperty({
    description:
      'New password — min 8 characters with at least 1 uppercase, 1 lowercase, 1 digit, and 1 special character',
    example: 'N3wS3cureP@ss',
    minLength: 8,
  })
  @IsString()
  @IsStrongPassword()
  newPassword: string;
}
