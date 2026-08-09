import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class LogoutDto {
  @ApiProperty({
    description:
      'Set to true to revoke every session for this user (logout everywhere). ' +
      'Omitting this logs out only the current session.',
    required: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  all?: boolean;
}