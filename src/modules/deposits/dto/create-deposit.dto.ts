import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CreateDepositDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[1-9]\d{0,9}(\.\d{1,2})?$/, {
    message:
      'amount must be a valid INR amount greater than 0 (e.g. 1000 or 2500.50)',
  })
  amount: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9_.\-]{6,40}$/, {
    message:
      'transactionId must be 6-40 characters: letters, numbers, underscores, dots, or hyphens',
  })
  transactionId: string;
}
