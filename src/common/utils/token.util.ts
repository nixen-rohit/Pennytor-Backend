import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * High-entropy opaque token helpers. Raw values are never stored — only
 * SHA-256 hashes — so a database leak yields nothing replayable, and
 * direct index lookup by hash keeps validation cheap.
 */

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}