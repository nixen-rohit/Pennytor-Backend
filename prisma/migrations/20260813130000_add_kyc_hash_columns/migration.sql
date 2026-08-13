-- Phase 1: add argon2id hash columns (nullable until the backfill script
-- fills them from the previously AES-256-GCM-encrypted values).
ALTER TABLE "kyc_applications" ADD COLUMN "aadhaarNumberHash" TEXT;
ALTER TABLE "kyc_applications" ADD COLUMN "aadhaarNumberLast4" TEXT;
ALTER TABLE "kyc_applications" ADD COLUMN "panNumberHash" TEXT;
ALTER TABLE "kyc_applications" ADD COLUMN "panNumberLast4" TEXT;
ALTER TABLE "kyc_applications" ADD COLUMN "accountNumberHash" TEXT;
ALTER TABLE "kyc_applications" ADD COLUMN "accountNumberLast4" TEXT;
ALTER TABLE "kyc_applications" ADD COLUMN "ifscCodeHash" TEXT;
ALTER TABLE "kyc_applications" ADD COLUMN "ifscCodeLast4" TEXT;
ALTER TABLE "kyc_applications" ADD COLUMN "nomineeAadhaarHash" TEXT;
ALTER TABLE "kyc_applications" ADD COLUMN "nomineeAadhaarLast4" TEXT;