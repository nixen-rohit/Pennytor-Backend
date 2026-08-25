import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

export class VerifyPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(100)
  password: string;
}