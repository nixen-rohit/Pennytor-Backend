import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({
    description:
      'Google OAuth2 access token obtained from the client-side Google Sign-In flow',
    example: 'ya29.a0AfH6SM...',
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}
