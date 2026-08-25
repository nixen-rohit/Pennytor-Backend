import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ContactMessageStatus } from '@prisma/client';

export class UpdateContactStatusDto {
  @IsNotEmpty()
  @IsEnum(ContactMessageStatus)
  status: ContactMessageStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}