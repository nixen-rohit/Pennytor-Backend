import { IsNotEmpty, IsString } from 'class-validator';
import { IsStrongPassword } from '../../../common/decorators/is-strong-password.decorator';

export class ChangePasswordDto {
    @IsString()
  @IsNotEmpty()
  currentPassword: string;

    @IsString()
  @IsStrongPassword()
  newPassword: string;
}
