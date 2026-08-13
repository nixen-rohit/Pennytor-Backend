/*
  Warnings:

  - Added the required column `fileType` to the `kyc_file_audit_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `storagePath` to the `kyc_file_audit_logs` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "kyc_file_audit_logs" DROP CONSTRAINT "kyc_file_audit_logs_fileId_fkey";

-- AlterTable
ALTER TABLE "kyc_file_audit_logs" ADD COLUMN     "fileType" "KycFileType" NOT NULL,
ADD COLUMN     "storagePath" TEXT NOT NULL,
ALTER COLUMN "fileId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "kyc_file_audit_logs" ADD CONSTRAINT "kyc_file_audit_logs_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "kyc_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
