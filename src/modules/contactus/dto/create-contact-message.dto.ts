import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateContactMessageDto {
  @IsString()
  @Length(2, 100)
  @Transform(trim)
  name: string;

  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10,15}$/, {
    message: 'phone must contain 10 to 15 digits',
  })
  @Transform(trim)
  phone: string;

  @IsString()
  @Length(10, 5000)
  @Transform(trim)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trim)
  service?: string;
}
