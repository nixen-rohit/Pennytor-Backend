import {
  AccountType,
  Gender,
  KycFileType,
  MaritalStatus,
} from '@prisma/client';

/** Default upload cap for a single KYC file: 2 MB. */
export const KYC_FILE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The KYC wizard sends display strings ("Male", "Savings Account", ...).
 * These maps translate them into the strict database enums. Unknown values
 * are rejected by the DTO before this code ever runs.
 */
export const GENDER_TO_ENUM: Record<string, Gender> = {
  Male: Gender.MALE,
  Female: Gender.FEMALE,
  Other: Gender.OTHER,
};

export const MARITAL_STATUS_TO_ENUM: Record<string, MaritalStatus> = {
  Single: MaritalStatus.SINGLE,
  Married: MaritalStatus.MARRIED,
  Divorced: MaritalStatus.DIVORCED,
  Widowed: MaritalStatus.WIDOWED,
};

export const ACCOUNT_TYPE_TO_ENUM: Record<string, AccountType> = {
  'Savings Account': AccountType.SAVINGS,
  'Current Account': AccountType.CURRENT,
  'Salary Account': AccountType.SALARY,
};

export const KYC_FILE_TYPE_LABEL: Record<KycFileType, string> = {
  [KycFileType.SELFIE]: 'Selfie',
  [KycFileType.AADHAAR_FRONT]: 'Aadhaar Front',
  [KycFileType.AADHAAR_BACK]: 'Aadhaar Back',
  [KycFileType.PAN]: 'PAN Card',
  [KycFileType.SIGNATURE]: 'Signature',
};
