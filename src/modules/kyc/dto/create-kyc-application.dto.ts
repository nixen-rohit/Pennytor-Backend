import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  ACCOUNT_TYPE_TO_ENUM,
  GENDER_TO_ENUM,
  MARITAL_STATUS_TO_ENUM,
} from '../kyc.types';

const NAME_PATTERN = /^[A-Za-z][A-Za-z\s.'-]{1,79}$/;
const PHONE_PATTERN = /^\+?[0-9\s-]{10,15}$/;
const AADHAAR_PATTERN = /^\d{12}$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const ACCOUNT_NUMBER_PATTERN = /^\d{9,18}$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * Upsert payload for a user's KYC application (all wizard steps at once,
 * stored as DRAFT until the OTP-verified submit call).
 */
export class CreateKycApplicationDto {
  // Step 1 — Personal
  @IsString()
  @IsNotEmpty()
  @Matches(NAME_PATTERN, { message: 'Full name contains invalid characters' })
  fullName: string;

  @IsString()
  @Matches(PHONE_PATTERN, { message: 'Enter a valid phone number' })
  phone: string;

  @IsDateString()
  dob: Date;

  @IsOptional()
  @IsIn(Object.keys(GENDER_TO_ENUM))
  gender?: string;

  @IsOptional()
  @IsIn(Object.keys(MARITAL_STATUS_TO_ENUM))
  maritalStatus?: string;

  // Step 2 — Aadhaar / PAN
  @IsString()
  @Matches(AADHAAR_PATTERN, {
    message: 'Enter a valid 12-digit Aadhaar number',
  })
  aadhaarNumber: string;

  @IsString()
  @Matches(PAN_PATTERN, { message: 'Enter a valid PAN number' })
  panNumber: string;

  // Step 3 — Bank
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  accountHolderName: string;

  @IsString()
  @Matches(ACCOUNT_NUMBER_PATTERN, {
    message: 'Enter a valid 9-18 digit account number',
  })
  accountNumber: string;

  @IsString()
  @Matches(IFSC_PATTERN, { message: 'Enter a valid 11-character IFSC code' })
  ifscCode: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  bankName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  branchName: string;

  @IsOptional()
  @IsIn(Object.keys(ACCOUNT_TYPE_TO_ENUM))
  accountType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  branchAddress?: string;

  // Step 4 — Nominee
  @IsString()
  @IsNotEmpty()
  @Matches(NAME_PATTERN, {
    message: 'Nominee name contains invalid characters',
  })
  nomineeName: string;

  @IsDateString()
  nomineeDob: Date;

  @IsOptional()
  @ValidateIf(
    (o: CreateKycApplicationDto) =>
      o.nomineePhone != null && o.nomineePhone.trim() !== '',
  )
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'Enter a valid nominee phone number' })
  nomineePhone: string;

  @IsString()
  @Matches(AADHAAR_PATTERN, {
    message: 'Enter a valid 12-digit nominee Aadhaar number',
  })
  nomineeAadhaar: string;
}
