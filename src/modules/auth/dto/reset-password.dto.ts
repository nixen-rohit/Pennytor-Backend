import { IsEmail, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { IsStrongPassword } from '../../../common/decorators/is-strong-password.decorator';

export class ResetPasswordDto {
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @IsString()
  @Length(64, 64)
  token: string;

  @IsString()
  @IsStrongPassword()
  newPassword: string;
}
