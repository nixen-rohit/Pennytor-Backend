import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { IsStrongPassword } from '../../../common/decorators/is-strong-password.decorator';

export class ChangePasswordDto {
  @ApiProperty({
    description: 'Current password for verification',
    example: 'OldPass123!',
  })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({
    description:
      'New password — min 8 characters with at least 1 uppercase, 1 lowercase, 1 digit, and 1 special character',
    example: 'N3wS3cureP@ss!',
    minLength: 8,
  })
  @IsString()
  @IsStrongPassword()
  newPassword: string;
}
