-- Drop the argon2id tamper-evidence hash columns — storage is now
-- AES-256-GCM ciphertext + last-4 display masks only.
ALTER TABLE "kyc_applications" DROP COLUMN "aadhaarNumberHash";
ALTER TABLE "kyc_applications" DROP COLUMN "panNumberHash";
ALTER TABLE "kyc_applications" DROP COLUMN "accountNumberHash";
ALTER TABLE "kyc_applications" DROP COLUMN "ifscCodeHash";
ALTER TABLE "kyc_applications" DROP COLUMN "nomineeAadhaarHash";