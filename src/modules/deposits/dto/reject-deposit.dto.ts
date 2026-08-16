import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectDepositDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note: string;
}