import { IsString, Matches } from 'class-validator';

export class SubmitKycApplicationDto {
  /** 6-digit OTP sent to the user's email (see OtpPurpose.KYC_SUBMIT). */
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit verification code' })
  otp: string;
}
