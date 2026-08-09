-- Server-side session auth: opaque sid cookie replaces JWT refresh tokens.
-- 1. Sessions carry the SHA-256 hash of the opaque session id + absolute expiry.
-- 2. The refresh_tokens table (and its chain/reuse machinery) is dropped —
--    server-side sessions provide revocation directly.

-- Any rows still present belong to the pre-cookie era (no client ever
-- received these ids as cookies), so they are safe to discard.
DELETE FROM "sessions";

ALTER TABLE "sessions" ADD COLUMN "tokenHash" TEXT;
ALTER TABLE "sessions" ADD COLUMN "expiresAt" TIMESTAMP(3);

UPDATE "sessions" SET "expiresAt" = NOW() + INTERVAL '30 days';

ALTER TABLE "sessions" ALTER COLUMN "tokenHash" SET NOT NULL;
ALTER TABLE "sessions" ALTER COLUMN "expiresAt" SET NOT NULL;

CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

DROP TABLE "refresh_tokens";