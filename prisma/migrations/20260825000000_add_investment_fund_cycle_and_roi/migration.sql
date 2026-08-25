-- AlterEnum
ALTER TYPE "LedgerSourceType" ADD VALUE 'INVESTMENT_REFUND';

-- AlterEnum
ALTER TYPE "LedgerSourceType" ADD VALUE 'INVESTMENT_ROI';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'APPROVE_INVESTMENT_FUND';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'REJECT_INVESTMENT_FUND';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'INVESTMENT_ROI_CREDIT';

-- AlterTable
ALTER TABLE "investment_applications" ADD COLUMN "verifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "investment_applications" ADD COLUMN "lastRoiPaidAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "investment_roi_payouts" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "roiPercent" DECIMAL(5,2) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_roi_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "investment_roi_payouts_applicationId_idx" ON "investment_roi_payouts"("applicationId");

-- CreateIndex
CREATE INDEX "investment_roi_payouts_userId_createdAt_idx" ON "investment_roi_payouts"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "investment_roi_payouts" ADD CONSTRAINT "investment_roi_payouts_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "investment_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_roi_payouts" ADD CONSTRAINT "investment_roi_payouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "investment_applications_verifiedAt_idx" ON "investment_applications"("verifiedAt");
