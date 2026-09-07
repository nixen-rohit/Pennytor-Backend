-- ════════════════════════════════════════════════════════════════════════════
--  Referral & Commission System (spec docs/referral.md)
-- ════════════════════════════════════════════════════════════════════════════
--
--  Adds:
--   - UserType + ReferralCodeStatus + CommissionStatus enums
--   - User.referralCode (nullable, unique), referralCodeStatus (nullable),
--     userType (default pennytor_user)
--   - CommissionLevelConfig table — single-row, L1..L5 rates + thresholds
--   - ReferralRelationship table — UNIQUE(referredUserId) prevents a
--     user from having more than one direct referrer
--   - ReferralCommission table — immutable snapshot per spec §20, with
--     a unique idempotency key covering the (referrer, referred,
--     investment, level, month, year) tuple
--   - ReferralCommissionRecord table — one row per recorded credit
--   - LedgerSourceType values REFERRAL_COMMISSION +
--     REFERRAL_COMMISSION_REVERSAL
--   - AuditAction values for the new referral/commission lifecycle
--
--  The previous schema already had a `referralEligible` boolean on
--  User (kept for admin soft-toggle) and a `referredById` self-relation.
--  We do NOT break those columns.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Enums ────────────────────────────────────────────────────────────────

CREATE TYPE "UserType" AS ENUM ('pennytor_user', 'super_user');
CREATE TYPE "ReferralCodeStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "CommissionStatus" AS ENUM ('CALCULATED', 'PAID', 'FROZEN', 'REVERSED');

-- ── Audit actions for the referral lifecycle ────────────────────────────

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REFERRAL_CODE_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REFERRAL_CODE_ACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REFERRAL_CODE_DEACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REFERRAL_COMMISSION_CALCULATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REFERRAL_COMMISSION_PAID';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REFERRAL_COMMISSION_FROZEN';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REFERRAL_COMMISSION_REVERSED';

-- ── Ledger source types for commission credits + reversals ──────────────

ALTER TYPE "LedgerSourceType" ADD VALUE IF NOT EXISTS 'REFERRAL_COMMISSION';
ALTER TYPE "LedgerSourceType" ADD VALUE IF NOT EXISTS 'REFERRAL_COMMISSION_REVERSAL';

-- ── User columns ────────────────────────────────────────────────────────

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "userType" "UserType" NOT NULL DEFAULT 'pennytor_user';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referralCodeStatus" "ReferralCodeStatus";
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referralEligible" BOOLEAN NOT NULL DEFAULT true;

-- Make referralCode unique (case-sensitive — codes are uppercase by convention).
CREATE UNIQUE INDEX IF NOT EXISTS "users_referralCode_key" ON "users"("referralCode");

-- Ensure referredById column exists (migrate from legacy referredBy if needed).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referredById" TEXT;

-- Index for the tree walk: find all direct referrals of a user.
CREATE INDEX IF NOT EXISTS "users_referredById_idx" ON "users"("referredById");
CREATE INDEX IF NOT EXISTS "users_role_status_idx" ON "users"("role", "status");

-- ── Commission level config (single row, id = 1) ────────────────────────

CREATE TABLE IF NOT EXISTS "commission_level_config" (
    "id"                   INTEGER     NOT NULL DEFAULT 1,
    "l1RatePercent"        DECIMAL(5,4) NOT NULL,
    "l2RatePercent"        DECIMAL(5,4) NOT NULL,
    "l3RatePercent"        DECIMAL(5,4) NOT NULL,
    "l4RatePercent"        DECIMAL(5,4) NOT NULL,
    "l5RatePercent"        DECIMAL(5,4) NOT NULL,
    "l2MinDirectVerified"  INTEGER     NOT NULL DEFAULT 3,
    "l3MinDirectVerified"  INTEGER     NOT NULL DEFAULT 6,
    "l4MinDirectVerified"  INTEGER     NOT NULL DEFAULT 9,
    "l5MinDirectVerified"  INTEGER     NOT NULL DEFAULT 12,
    "maxDepth"             INTEGER     NOT NULL DEFAULT 5,
    "active"               BOOLEAN     NOT NULL DEFAULT true,
    "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "commission_level_config_pkey" PRIMARY KEY ("id")
);

-- Seed the spec's defaults.
INSERT INTO "commission_level_config" (
    "id", "l1RatePercent", "l2RatePercent", "l3RatePercent",
    "l4RatePercent", "l5RatePercent", "updatedAt"
) VALUES (
    1, 0.5, 0.25, 0.25, 0.25, 0.25, CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

-- ── Referral relationships ──────────────────────────────────────────────
--
-- A user can have AT MOST one direct referrer — `referredUserId` is
-- UNIQUE. The CASCADE delete keeps the relationship tidy if either
-- side is removed.

CREATE TABLE IF NOT EXISTS "referral_relationships" (
    "id"             TEXT         NOT NULL,
    "referrerId"     TEXT         NOT NULL,
    "referredUserId" TEXT         NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "referral_relationships_pkey" PRIMARY KEY ("id")
);

-- The single most important constraint: one direct referrer per user.
CREATE UNIQUE INDEX IF NOT EXISTS "referral_relationships_referredUserId_key"
    ON "referral_relationships"("referredUserId");

-- Prevent self-reference at the DB level (defence in depth — the service
-- also checks this).
ALTER TABLE "referral_relationships"
    DROP CONSTRAINT IF EXISTS "referral_relationships_no_self_ref";
ALTER TABLE "referral_relationships"
    ADD CONSTRAINT "referral_relationships_no_self_ref"
    CHECK ("referrerId" <> "referredUserId");

CREATE INDEX IF NOT EXISTS "referral_relationships_referrerId_idx"
    ON "referral_relationships"("referrerId");
CREATE INDEX IF NOT EXISTS "referral_relationships_createdAt_idx"
    ON "referral_relationships"("createdAt");

-- FKs
ALTER TABLE "referral_relationships"
    DROP CONSTRAINT IF EXISTS "referral_relationships_referrerId_fkey";
ALTER TABLE "referral_relationships"
    ADD CONSTRAINT "referral_relationships_referrerId_fkey"
    FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE CASCADE;

ALTER TABLE "referral_relationships"
    DROP CONSTRAINT IF EXISTS "referral_relationships_referredUserId_fkey";
ALTER TABLE "referral_relationships"
    ADD CONSTRAINT "referral_relationships_referredUserId_fkey"
    FOREIGN KEY ("referredUserId") REFERENCES "users"("id") ON DELETE CASCADE;

-- ── Referral commissions (immutable snapshots, spec §20) ───────────────
--
-- The UNIQUE INDEX on (referrerId, referredUserId, investmentId, level,
-- commissionMonth, commissionYear) is the final guard against duplicate
-- payouts (spec §8, §17). Even if the scheduler runs twice in the same
-- minute, only the first INSERT survives.

CREATE TABLE IF NOT EXISTS "referral_commissions" (
    "id"                              TEXT           NOT NULL,
    "referrerId"                      TEXT           NOT NULL,
    "referredUserId"                  TEXT           NOT NULL,
    "investmentId"                    TEXT           NOT NULL,
    "level"                           INTEGER        NOT NULL,
    "investmentAmountSnapshot"        DECIMAL(12, 2) NOT NULL,
    "commissionRateSnapshot"          DECIMAL(5, 4)  NOT NULL,
    "qualifyingDirectReferralCount"   INTEGER        NOT NULL,
    "commissionAmount"                DECIMAL(12, 2) NOT NULL,
    "commissionMonth"                 INTEGER        NOT NULL,
    "commissionYear"                  INTEGER        NOT NULL,
    "status"                          "CommissionStatus" NOT NULL DEFAULT 'CALCULATED',
    "paidAt"                          TIMESTAMP(3),
    "frozenAt"                        TIMESTAMP(3),
    "reversedAt"                      TIMESTAMP(3),
    "reversalOfId"                    TEXT,
    "createdAt"                       TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "referral_commissions_pkey" PRIMARY KEY ("id")
);

-- Idempotency constraint — the heart of the system.
CREATE UNIQUE INDEX IF NOT EXISTS "referral_commission_idempotency"
    ON "referral_commissions"(
        "referrerId", "referredUserId", "investmentId",
        "level", "commissionMonth", "commissionYear"
    );

-- A reversal is a 1:1 link to the original row.
CREATE UNIQUE INDEX IF NOT EXISTS "referral_commissions_reversalOfId_key"
    ON "referral_commissions"("reversalOfId");

CREATE INDEX IF NOT EXISTS "referral_commissions_referrerId_createdAt_idx"
    ON "referral_commissions"("referrerId", "createdAt");
CREATE INDEX IF NOT EXISTS "referral_commissions_referredUserId_idx"
    ON "referral_commissions"("referredUserId");
CREATE INDEX IF NOT EXISTS "referral_commissions_status_idx"
    ON "referral_commissions"("status");
CREATE INDEX IF NOT EXISTS "referral_commissions_year_month_idx"
    ON "referral_commissions"("commissionYear", "commissionMonth");

ALTER TABLE "referral_commissions"
    DROP CONSTRAINT IF EXISTS "referral_commissions_referrerId_fkey";
ALTER TABLE "referral_commissions"
    ADD CONSTRAINT "referral_commissions_referrerId_fkey"
    FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE CASCADE;

ALTER TABLE "referral_commissions"
    DROP CONSTRAINT IF EXISTS "referral_commissions_referredUserId_fkey";
ALTER TABLE "referral_commissions"
    ADD CONSTRAINT "referral_commissions_referredUserId_fkey"
    FOREIGN KEY ("referredUserId") REFERENCES "users"("id") ON DELETE CASCADE;

ALTER TABLE "referral_commissions"
    DROP CONSTRAINT IF EXISTS "referral_commissions_reversalOfId_fkey";
ALTER TABLE "referral_commissions"
    ADD CONSTRAINT "referral_commissions_reversalOfId_fkey"
    FOREIGN KEY ("reversalOfId") REFERENCES "referral_commissions"("id");

-- ── Per-credit record (one row per commission "ticket") ─────────────────

CREATE TABLE IF NOT EXISTS "referral_commission_records" (
    "id"           TEXT           NOT NULL,
    "commissionId" TEXT           NOT NULL,
    "amount"       DECIMAL(12, 2) NOT NULL,
    "createdAt"    TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "referral_commission_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "referral_commission_records_commissionId_key"
    ON "referral_commission_records"("commissionId");

-- ── Backfill: users created before this migration already have
--    ownReferralCode values; copy them into the new column so the UI
--    keeps working until the first investment verification runs.

UPDATE "users"
SET "referralCode" = "ownReferralCode"
WHERE "referralCode" IS NULL
  AND "ownReferralCode" IS NOT NULL;

UPDATE "users"
SET "referralCodeStatus" = 'ACTIVE'
WHERE "referralCodeStatus" IS NULL
  AND "referralCode" IS NOT NULL
  AND "role" <> 'ADMIN';
