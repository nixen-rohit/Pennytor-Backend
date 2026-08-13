-- Re-introduce AES-256-GCM ciphertext columns for ADMIN review visibility.
-- The argon2id hash columns (tamper evidence) and last-4 columns (user
-- masks) stay. Existing rows have no recoverable plaintext — their encrypted
-- columns are left NULL until the applicant resubmits.
ALTER TABLE "kyc_applications" ADD COLUMN "aadhaarNumberEncrypted" TEXT;
ALTER TABLE "kyc_applications" ADD COLUMN "panNumberEncrypted" TEXT;
ALTER TABLE "kyc_applications" ADD COLUMN "accountNumberEncrypted" TEXT;
ALTER TABLE "kyc_applications" ADD COLUMN "ifscCodeEncrypted" TEXT;
ALTER TABLE "kyc_applications" ADD COLUMN "nomineeAadhaarEncrypted" TEXT;