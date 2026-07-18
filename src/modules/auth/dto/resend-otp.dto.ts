import { IsEmail } from 'class-validator';
import { Transform } from 'class-transformer';

export class ResendOtpDto {
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;
}
