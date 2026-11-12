-- Nominee Aadhaar is optional: applicants may leave it blank. Store NULL
-- rather than an empty string so the API can distinguish "not provided"
-- from a masked value.
ALTER TABLE "kyc_applications" ALTER COLUMN "nomineeAadhaarLast4" DROP NOT NULL;
