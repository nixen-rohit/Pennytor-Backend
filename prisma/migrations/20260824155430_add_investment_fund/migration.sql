-- CreateEnum
CREATE TYPE "InvestmentScheme" AS ENUM ('A', 'B', 'C', 'D', 'E');

-- CreateEnum
CREATE TYPE "InvestmentStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "investment_applications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scheme" "InvestmentScheme" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" "InvestmentStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "investment_applications_userId_idx" ON "investment_applications"("userId");

-- CreateIndex
CREATE INDEX "investment_applications_status_idx" ON "investment_applications"("status");

-- CreateIndex
CREATE INDEX "investment_applications_createdAt_idx" ON "investment_applications"("createdAt");

-- CreateIndex
CREATE INDEX "investment_applications_submittedAt_idx" ON "investment_applications"("submittedAt");

-- AddForeignKey
ALTER TABLE "investment_applications" ADD CONSTRAINT "investment_applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
