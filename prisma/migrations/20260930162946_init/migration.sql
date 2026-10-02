/*
  Warnings:

  - You are about to drop the column `referredBy` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[transactionId]` on the table `deposit_requests` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[applicationId,monthNumber]` on the table `sip_for_child_premiums` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "FixedDepositPlanId" AS ENUM ('FD_25000', 'FD_50000', 'FD_100000');

-- CreateEnum
CREATE TYPE "FixedDepositStatus" AS ENUM ('PENDING', 'VERIFIED', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FixedDepositPayoutStatus" AS ENUM ('PENDING', 'PAID');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvestmentStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "InvestmentStatus" ADD VALUE 'COMPLETED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerSourceType" ADD VALUE 'FD_DEPOSIT';
ALTER TYPE "LedgerSourceType" ADD VALUE 'FD_PAYOUT';

-- DropForeignKey
ALTER TABLE "referral_commissions" DROP CONSTRAINT "referral_commissions_referredUserId_fkey";

-- DropForeignKey
ALTER TABLE "referral_commissions" DROP CONSTRAINT "referral_commissions_referrerId_fkey";

-- DropForeignKey
ALTER TABLE "referral_commissions" DROP CONSTRAINT "referral_commissions_reversalOfId_fkey";

-- DropForeignKey
ALTER TABLE "referral_relationships" DROP CONSTRAINT "referral_relationships_referredUserId_fkey";

-- DropForeignKey
ALTER TABLE "referral_relationships" DROP CONSTRAINT "referral_relationships_referrerId_fkey";

-- AlterTable
ALTER TABLE "commission_level_config" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "referredBy";

-- CreateTable
CREATE TABLE "fixed_deposit_applications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" "FixedDepositPlanId" NOT NULL,
    "depositAmount" DECIMAL(12,2) NOT NULL,
    "lockInMonths" INTEGER NOT NULL,
    "payoutMode" TEXT NOT NULL,
    "emiAmount" DECIMAL(12,2) NOT NULL,
    "totalEmis" INTEGER NOT NULL,
    "totalPayout" DECIMAL(12,2) NOT NULL,
    "status" "FixedDepositStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "nextPayoutAt" TIMESTAMP(3),
    "emisPaid" INTEGER NOT NULL DEFAULT 0,
    "lastPayoutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_deposit_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_deposit_payouts" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emiNumber" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "FixedDepositPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_deposit_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fixed_deposit_applications_userId_idx" ON "fixed_deposit_applications"("userId");

-- CreateIndex
CREATE INDEX "fixed_deposit_applications_status_idx" ON "fixed_deposit_applications"("status");

-- CreateIndex
CREATE INDEX "fixed_deposit_applications_status_nextPayoutAt_idx" ON "fixed_deposit_applications"("status", "nextPayoutAt");

-- CreateIndex
CREATE INDEX "fixed_deposit_applications_createdAt_idx" ON "fixed_deposit_applications"("createdAt");

-- CreateIndex
CREATE INDEX "fixed_deposit_payouts_applicationId_idx" ON "fixed_deposit_payouts"("applicationId");

-- CreateIndex
CREATE INDEX "fixed_deposit_payouts_userId_idx" ON "fixed_deposit_payouts"("userId");

-- CreateIndex
CREATE INDEX "fixed_deposit_payouts_status_idx" ON "fixed_deposit_payouts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_deposit_payouts_applicationId_emiNumber_key" ON "fixed_deposit_payouts"("applicationId", "emiNumber");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_requests_transactionId_key" ON "deposit_requests"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "sip_for_child_premiums_applicationId_monthNumber_key" ON "sip_for_child_premiums"("applicationId", "monthNumber");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_relationships" ADD CONSTRAINT "referral_relationships_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_relationships" ADD CONSTRAINT "referral_relationships_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "referral_commissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_deposit_applications" ADD CONSTRAINT "fixed_deposit_applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_deposit_payouts" ADD CONSTRAINT "fixed_deposit_payouts_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "fixed_deposit_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_deposit_payouts" ADD CONSTRAINT "fixed_deposit_payouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "referral_commission_idempotency" RENAME TO "referral_commissions_referrerId_referredUserId_investmentId_key";

-- RenameIndex
ALTER INDEX "referral_commissions_year_month_idx" RENAME TO "referral_commissions_commissionYear_commissionMonth_idx";
