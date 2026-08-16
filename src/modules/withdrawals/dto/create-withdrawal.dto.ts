import {
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateWithdrawalDto {
  /** 'bank' = registered bank account (from KYC), 'upi' = UPI ID. */
  @IsIn(['bank', 'upi'])
  method: 'bank' | 'upi';

  /** UPI ID when method=upi; otherwise a label like 'Registered bank account'. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  destination: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'amount must be a valid INR amount (e.g. 1000 or 2500.50)',
  })
  amount: string;

  /** Account password — re-verified server-side to confirm intent. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password: string;

  /** 6-digit OTP emailed for this withdrawal (OtpPurpose.WITHDRAW_SUBMIT). */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'otp must be a 6-digit code' })
  otp: string;
}