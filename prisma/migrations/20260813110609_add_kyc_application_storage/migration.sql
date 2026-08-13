-- CreateEnum
CREATE TYPE "KycApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "KycFileType" AS ENUM ('SELFIE', 'AADHAAR_FRONT', 'AADHAAR_BACK', 'PAN', 'SIGNATURE');

-- CreateEnum
CREATE TYPE "KycFileAuditAction" AS ENUM ('VIEW', 'DOWNLOAD', 'DELETE');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('SAVINGS', 'CURRENT', 'SALARY');

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'KYC_SUBMIT';

-- CreateTable
CREATE TABLE "kyc_applications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "KycApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "dob" TIMESTAMP(3) NOT NULL,
    "gender" "Gender",
    "maritalStatus" "MaritalStatus",
    "aadhaarNumber" TEXT NOT NULL,
    "panNumber" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "ifscCode" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "accountType" "AccountType",
    "branchAddress" TEXT,
    "nomineeName" TEXT NOT NULL,
    "nomineeDob" TIMESTAMP(3) NOT NULL,
    "nomineePhone" TEXT NOT NULL,
    "nomineeAadhaar" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_files" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" "KycFileType" NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_file_audit_logs" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" "KycFileAuditAction" NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_file_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kyc_applications_status_idx" ON "kyc_applications"("status");

-- CreateIndex
CREATE INDEX "kyc_applications_createdAt_idx" ON "kyc_applications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_applications_userId_key" ON "kyc_applications"("userId");

-- CreateIndex
CREATE INDEX "kyc_files_applicationId_idx" ON "kyc_files"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_files_applicationId_type_key" ON "kyc_files"("applicationId", "type");

-- CreateIndex
CREATE INDEX "kyc_file_audit_logs_fileId_idx" ON "kyc_file_audit_logs"("fileId");

-- CreateIndex
CREATE INDEX "kyc_file_audit_logs_adminId_idx" ON "kyc_file_audit_logs"("adminId");

-- CreateIndex
CREATE INDEX "kyc_file_audit_logs_action_idx" ON "kyc_file_audit_logs"("action");

-- AddForeignKey
ALTER TABLE "kyc_applications" ADD CONSTRAINT "kyc_applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_files" ADD CONSTRAINT "kyc_files_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "kyc_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_file_audit_logs" ADD CONSTRAINT "kyc_file_audit_logs_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "kyc_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
