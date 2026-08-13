-- Drop the orphaned approvedAt column. It was never used by the
-- application: no code reads it (Prisma schema no longer declares it),
-- approval state is tracked by isApproved + approvedAt never surfaced.
ALTER TABLE "users" DROP COLUMN "approvedAt";
