-- CreateEnum
CREATE TYPE "SIPStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SIPPlanId" AS ENUM ('PLAN_5000', 'PLAN_2500');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'APPROVE_SIP_FOR_CHILD';
ALTER TYPE "AuditAction" ADD VALUE 'REJECT_SIP_FOR_CHILD';
ALTER TYPE "AuditAction" ADD VALUE 'SIP_PREMIUM_PAID';
ALTER TYPE "AuditAction" ADD VALUE 'SIP_FOR_CHILD_AUTO_REJECTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerSourceType" ADD VALUE 'SIP_FOR_CHILD';
ALTER TYPE "LedgerSourceType" ADD VALUE 'SIP_FOR_CHILD_REFUND';

-- CreateTable
CREATE TABLE "sip_for_child_applications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scheme" "SIPPlanId" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" "SIPStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "totalMonths" INTEGER NOT NULL DEFAULT 120,
    "monthsPaid" INTEGER NOT NULL DEFAULT 0,
    "monthsMissed" INTEGER NOT NULL DEFAULT 0,
    "nextPaymentDue" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "lastPaidAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sip_for_child_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sip_for_child_premiums" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "monthNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sip_for_child_premiums_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sip_for_child_applications_userId_idx" ON "sip_for_child_applications"("userId");

-- CreateIndex
CREATE INDEX "sip_for_child_applications_status_idx" ON "sip_for_child_applications"("status");

-- CreateIndex
CREATE INDEX "sip_for_child_applications_createdAt_idx" ON "sip_for_child_applications"("createdAt");

-- CreateIndex
CREATE INDEX "sip_for_child_applications_submittedAt_idx" ON "sip_for_child_applications"("submittedAt");

-- CreateIndex
CREATE INDEX "sip_for_child_applications_verifiedAt_idx" ON "sip_for_child_applications"("verifiedAt");

-- CreateIndex
CREATE INDEX "sip_for_child_premiums_applicationId_idx" ON "sip_for_child_premiums"("applicationId");

-- CreateIndex
CREATE INDEX "sip_for_child_premiums_userId_createdAt_idx" ON "sip_for_child_premiums"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "sip_for_child_applications" ADD CONSTRAINT "sip_for_child_applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sip_for_child_premiums" ADD CONSTRAINT "sip_for_child_premiums_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "sip_for_child_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sip_for_child_premiums" ADD CONSTRAINT "sip_for_child_premiums_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
