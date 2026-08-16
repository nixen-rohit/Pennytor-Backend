import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CreateDepositDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'amount must be a valid INR amount (e.g. 1000 or 2500.50)',
  })
  amount: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  transactionId: string;
}