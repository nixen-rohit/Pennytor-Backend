import { randomBytes } from 'crypto';

/**
 * Generates an 8-character uppercase alphanumeric referral code,
 * e.g. "A1B2C3D4". Used identically for USER and ADMIN accounts so
 * that admins can also act as referrers.
 */
export function generateReferralCode(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}
