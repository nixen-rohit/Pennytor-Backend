-- Add the REPLACE audit action and a metadata snapshot column so admin
-- document replacements keep an evidence trail after the old file is deleted.

ALTER TYPE "KycFileAuditAction" ADD VALUE 'REPLACE';

ALTER TABLE "kyc_file_audit_logs"
  ADD COLUMN "metadata" JSONB;
