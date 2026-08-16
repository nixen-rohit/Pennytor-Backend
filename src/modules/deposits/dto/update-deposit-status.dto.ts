import { DepositStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDepositStatusDto {
  @IsEnum(DepositStatus)
  status: DepositStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}