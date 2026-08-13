-- Phase 2: drop the legacy plaintext/encrypted columns now that the backfill
-- script has populated the argon2id hash columns, and lock the new columns
-- as NOT NULL.
ALTER TABLE "kyc_applications" DROP COLUMN "aadhaarNumber";
ALTER TABLE "kyc_applications" DROP COLUMN "panNumber";
ALTER TABLE "kyc_applications" DROP COLUMN "accountNumber";
ALTER TABLE "kyc_applications" DROP COLUMN "ifscCode";
ALTER TABLE "kyc_applications" DROP COLUMN "nomineeAadhaar";

ALTER TABLE "kyc_applications" ALTER COLUMN "aadhaarNumberHash" SET NOT NULL;
ALTER TABLE "kyc_applications" ALTER COLUMN "aadhaarNumberLast4" SET NOT NULL;
ALTER TABLE "kyc_applications" ALTER COLUMN "panNumberHash" SET NOT NULL;
ALTER TABLE "kyc_applications" ALTER COLUMN "panNumberLast4" SET NOT NULL;
ALTER TABLE "kyc_applications" ALTER COLUMN "accountNumberHash" SET NOT NULL;
ALTER TABLE "kyc_applications" ALTER COLUMN "accountNumberLast4" SET NOT NULL;
ALTER TABLE "kyc_applications" ALTER COLUMN "ifscCodeHash" SET NOT NULL;
ALTER TABLE "kyc_applications" ALTER COLUMN "ifscCodeLast4" SET NOT NULL;
ALTER TABLE "kyc_applications" ALTER COLUMN "nomineeAadhaarHash" SET NOT NULL;
ALTER TABLE "kyc_applications" ALTER COLUMN "nomineeAadhaarLast4" SET NOT NULL;