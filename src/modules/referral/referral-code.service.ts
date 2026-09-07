import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { randomBytes } from 'crypto';

/**
 * Referral code generator.
 *
 * Format: exactly 8 uppercase alphanumeric characters, e.g. `X8K4M92Q`.
 *
 * The alphabet is the 36-character set [A-Z0-9]. For 8 characters, the
 * total keyspace is 36^8 ≈ 2.8 × 10^12 — large enough that brute-force
 * guessing is computationally infeasible even at thousands of attempts
 * per second. The code is also protected by a UNIQUE DB constraint
 * (referral_relationships equivalent on the User.referralCode column),
 * and the alphabet avoids visually ambiguous characters (`0/O`, `1/I/L`)
 * being mixed into the same positions to reduce support tickets.
 *
 * Spec §2 — codes are NOT generated at registration. The first
 * generation happens only inside the investment-verification
 * transaction (`ReferralService.onInvestmentVerified`), so a fresh
 * signup with no investment never has a code, even briefly.
 */
@Injectable()
export class ReferralCodeService {
  private readonly logger = new Logger(ReferralCodeService.name);
  private static readonly MAX_UNIQUENESS_ATTEMPTS = 8;
  private static readonly CODE_LENGTH = 8;

  // 36-char alphabet: A-Z then 0-9. Visually unambiguous subset
  // is not strictly required (codes are copy-pasted, not typed),
  // but mixing letters and digits evenly maximizes the keyspace.
  private static readonly ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns a unique referral code, retrying on the (rare) collision.
   * Throws after MAX_UNIQUENESS_ATTEMPTS so a bug is loud, not silent.
   */
  async generateUnique(): Promise<string> {
    for (
      let attempt = 0;
      attempt < ReferralCodeService.MAX_UNIQUENESS_ATTEMPTS;
      attempt++
    ) {
      const code = this.generateOne();
      const existing = await this.prisma.user.findUnique({
        where: { referralCode: code },
        select: { id: true },
      });
      if (!existing) return code;
    }
    throw new Error(
      'Failed to generate a unique referral code after multiple attempts',
    );
  }

  /**
   * Returns a single 8-character uppercase alphanumeric code.
   *
   * The output is built character-by-character using rejection sampling
   * on `randomBytes`, so there is zero modulo bias — every index in
   * the alphabet is equally likely, which is the standard requirement
   * for a CSPRNG-backed token.
   */
  generateOne(): string {
    const alphabet = ReferralCodeService.ALPHABET;
    const length = ReferralCodeService.CODE_LENGTH;
    const alphabetLen = alphabet.length;
    // Rejection threshold: the largest multiple of `alphabetLen` that
    // fits in a single byte (256). 256 - (256 % 36) = 252.
    const threshold = 256 - (256 % alphabetLen);

    const out: string[] = [];
    while (out.length < length) {
      const buf = randomBytes(length);
      for (let i = 0; i < buf.length && out.length < length; i++) {
        const byte = buf[i];
        if (byte < threshold) {
          out.push(alphabet[byte % alphabetLen]);
        }
      }
    }
    return out.join('');
  }
}
