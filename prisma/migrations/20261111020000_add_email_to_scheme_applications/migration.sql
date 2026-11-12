-- Denormalised applicant email on every investment-scheme table, so records
-- can be found by email without joining users. Backfilled from the owner.
ALTER TABLE "fixed_deposit_applications" ADD COLUMN "email" TEXT;
ALTER TABLE "investment_applications" ADD COLUMN "email" TEXT;
ALTER TABLE "sip_for_child_applications" ADD COLUMN "email" TEXT;

UPDATE "fixed_deposit_applications" a
SET "email" = u."email"
FROM "users" u
WHERE u."id" = a."userId" AND a."email" IS NULL;

UPDATE "investment_applications" a
SET "email" = u."email"
FROM "users" u
WHERE u."id" = a."userId" AND a."email" IS NULL;

UPDATE "sip_for_child_applications" a
SET "email" = u."email"
FROM "users" u
WHERE u."id" = a."userId" AND a."email" IS NULL;

CREATE INDEX "fixed_deposit_applications_email_idx" ON "fixed_deposit_applications"("email");
CREATE INDEX "investment_applications_email_idx" ON "investment_applications"("email");
CREATE INDEX "sip_for_child_applications_email_idx" ON "sip_for_child_applications"("email");
