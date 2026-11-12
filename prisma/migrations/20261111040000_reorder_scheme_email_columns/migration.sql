-- Reorder the denormalised `email` column so it sits directly after `userId`
-- in the three investment-scheme tables. PostgreSQL cannot reorder an
-- existing column, so each table is rebuilt (data + constraints + indexes)
-- inside the migration transaction.
--
-- This is purely cosmetic for human/ops browsing; it does not change any
-- type, constraint, default or data value.

-- ============================================================
-- fixed_deposit_applications
-- ============================================================
ALTER TABLE "fixed_deposit_payouts"
  DROP CONSTRAINT "fixed_deposit_payouts_applicationId_fkey";

CREATE TABLE "fixed_deposit_applications_new" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "email"         TEXT,
  "planId"        "FixedDepositPlanId" NOT NULL,
  "depositAmount" DECIMAL(12,2) NOT NULL,
  "lockInMonths"  INTEGER NOT NULL,
  "payoutMode"    TEXT NOT NULL,
  "emiAmount"     DECIMAL(12,2) NOT NULL,
  "totalEmis"     INTEGER NOT NULL,
  "totalPayout"   DECIMAL(12,2) NOT NULL,
  "status"        "FixedDepositStatus" NOT NULL DEFAULT 'PENDING',
  "reviewNote"    TEXT,
  "reviewedBy"    TEXT,
  "reviewedAt"    TIMESTAMP(3),
  "submittedAt"   TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt"    TIMESTAMP(3),
  "nextPayoutAt"  TIMESTAMP(3),
  "emisPaid"      INTEGER NOT NULL DEFAULT 0,
  "lastPayoutAt"  TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL
);

INSERT INTO "fixed_deposit_applications_new"
  ("id", "userId", "email", "planId", "depositAmount", "lockInMonths",
   "payoutMode", "emiAmount", "totalEmis", "totalPayout", "status",
   "reviewNote", "reviewedBy", "reviewedAt", "submittedAt", "verifiedAt",
   "nextPayoutAt", "emisPaid", "lastPayoutAt", "createdAt", "updatedAt")
SELECT
   "id", "userId", "email", "planId", "depositAmount", "lockInMonths",
   "payoutMode", "emiAmount", "totalEmis", "totalPayout", "status",
   "reviewNote", "reviewedBy", "reviewedAt", "submittedAt", "verifiedAt",
   "nextPayoutAt", "emisPaid", "lastPayoutAt", "createdAt", "updatedAt"
FROM "fixed_deposit_applications";

ALTER TABLE "fixed_deposit_applications" RENAME TO "fixed_deposit_applications_old";
ALTER TABLE "fixed_deposit_applications_new" RENAME TO "fixed_deposit_applications";
DROP TABLE "fixed_deposit_applications_old";

ALTER TABLE "fixed_deposit_applications"
  ADD CONSTRAINT "fixed_deposit_applications_pkey" PRIMARY KEY ("id");
ALTER TABLE "fixed_deposit_applications"
  ADD CONSTRAINT "fixed_deposit_applications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "fixed_deposit_applications_createdAt_idx" ON "fixed_deposit_applications"("createdAt");
CREATE INDEX "fixed_deposit_applications_email_idx" ON "fixed_deposit_applications"("email");
CREATE INDEX "fixed_deposit_applications_status_idx" ON "fixed_deposit_applications"("status");
CREATE INDEX "fixed_deposit_applications_status_nextPayoutAt_idx" ON "fixed_deposit_applications"("status", "nextPayoutAt");
CREATE INDEX "fixed_deposit_applications_userId_idx" ON "fixed_deposit_applications"("userId");

ALTER TABLE "fixed_deposit_payouts"
  ADD CONSTRAINT "fixed_deposit_payouts_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "fixed_deposit_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- investment_applications
-- ============================================================
ALTER TABLE "investment_roi_payouts"
  DROP CONSTRAINT "investment_roi_payouts_applicationId_fkey";

CREATE TABLE "investment_applications_new" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "email"         TEXT,
  "scheme"        "InvestmentScheme" NOT NULL,
  "amount"        DECIMAL(12,2) NOT NULL,
  "method"        TEXT NOT NULL,
  "destination"   TEXT NOT NULL,
  "status"        "InvestmentStatus" NOT NULL DEFAULT 'PENDING',
  "reviewNote"    TEXT,
  "reviewedBy"    TEXT,
  "reviewedAt"    TIMESTAMP(3),
  "submittedAt"   TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "verifiedAt"    TIMESTAMP(3),
  "lastRoiPaidAt" TIMESTAMP(3)
);

INSERT INTO "investment_applications_new"
  ("id", "userId", "email", "scheme", "amount", "method", "destination",
   "status", "reviewNote", "reviewedBy", "reviewedAt", "submittedAt",
   "createdAt", "updatedAt", "verifiedAt", "lastRoiPaidAt")
SELECT
   "id", "userId", "email", "scheme", "amount", "method", "destination",
   "status", "reviewNote", "reviewedBy", "reviewedAt", "submittedAt",
   "createdAt", "updatedAt", "verifiedAt", "lastRoiPaidAt"
FROM "investment_applications";

ALTER TABLE "investment_applications" RENAME TO "investment_applications_old";
ALTER TABLE "investment_applications_new" RENAME TO "investment_applications";
DROP TABLE "investment_applications_old";

ALTER TABLE "investment_applications"
  ADD CONSTRAINT "investment_applications_pkey" PRIMARY KEY ("id");
ALTER TABLE "investment_applications"
  ADD CONSTRAINT "investment_applications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "investment_applications_createdAt_idx" ON "investment_applications"("createdAt");
CREATE INDEX "investment_applications_email_idx" ON "investment_applications"("email");
CREATE INDEX "investment_applications_status_idx" ON "investment_applications"("status");
CREATE INDEX "investment_applications_submittedAt_idx" ON "investment_applications"("submittedAt");
CREATE INDEX "investment_applications_userId_idx" ON "investment_applications"("userId");
CREATE INDEX "investment_applications_verifiedAt_idx" ON "investment_applications"("verifiedAt");

ALTER TABLE "investment_roi_payouts"
  ADD CONSTRAINT "investment_roi_payouts_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "investment_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- sip_for_child_applications
-- ============================================================
ALTER TABLE "sip_for_child_premiums"
  DROP CONSTRAINT "sip_for_child_premiums_applicationId_fkey";

CREATE TABLE "sip_for_child_applications_new" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "email"          TEXT,
  "scheme"         "SIPPlanId" NOT NULL,
  "amount"         DECIMAL(12,2) NOT NULL,
  "method"         TEXT NOT NULL,
  "destination"    TEXT NOT NULL,
  "status"         "SIPStatus" NOT NULL DEFAULT 'PENDING',
  "reviewNote"     TEXT,
  "reviewedBy"     TEXT,
  "reviewedAt"     TIMESTAMP(3),
  "submittedAt"    TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "totalMonths"    INTEGER NOT NULL DEFAULT 120,
  "monthsPaid"     INTEGER NOT NULL DEFAULT 0,
  "monthsMissed"   INTEGER NOT NULL DEFAULT 0,
  "nextPaymentDue" TIMESTAMP(3),
  "startedAt"      TIMESTAMP(3),
  "lastPaidAt"     TIMESTAMP(3),
  "verifiedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL
);

INSERT INTO "sip_for_child_applications_new"
  ("id", "userId", "email", "scheme", "amount", "method", "destination",
   "status", "reviewNote", "reviewedBy", "reviewedAt", "submittedAt",
   "totalMonths", "monthsPaid", "monthsMissed", "nextPaymentDue",
   "startedAt", "lastPaidAt", "verifiedAt", "createdAt", "updatedAt")
SELECT
   "id", "userId", "email", "scheme", "amount", "method", "destination",
   "status", "reviewNote", "reviewedBy", "reviewedAt", "submittedAt",
   "totalMonths", "monthsPaid", "monthsMissed", "nextPaymentDue",
   "startedAt", "lastPaidAt", "verifiedAt", "createdAt", "updatedAt"
FROM "sip_for_child_applications";

ALTER TABLE "sip_for_child_applications" RENAME TO "sip_for_child_applications_old";
ALTER TABLE "sip_for_child_applications_new" RENAME TO "sip_for_child_applications";
DROP TABLE "sip_for_child_applications_old";

ALTER TABLE "sip_for_child_applications"
  ADD CONSTRAINT "sip_for_child_applications_pkey" PRIMARY KEY ("id");
ALTER TABLE "sip_for_child_applications"
  ADD CONSTRAINT "sip_for_child_applications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "sip_for_child_applications_createdAt_idx" ON "sip_for_child_applications"("createdAt");
CREATE INDEX "sip_for_child_applications_email_idx" ON "sip_for_child_applications"("email");
CREATE INDEX "sip_for_child_applications_status_idx" ON "sip_for_child_applications"("status");
CREATE INDEX "sip_for_child_applications_submittedAt_idx" ON "sip_for_child_applications"("submittedAt");
CREATE INDEX "sip_for_child_applications_userId_idx" ON "sip_for_child_applications"("userId");
CREATE INDEX "sip_for_child_applications_verifiedAt_idx" ON "sip_for_child_applications"("verifiedAt");

ALTER TABLE "sip_for_child_premiums"
  ADD CONSTRAINT "sip_for_child_premiums_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "sip_for_child_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
