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
      'New password — min 12 characters with mixed case, number, and special char',
    example: 'N3wS3cureP@ssword!',
    minLength: 12,
  })
  @IsString()
  @IsStrongPassword()
  newPassword: string;
}
