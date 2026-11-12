import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  InvestmentStatus,
  SIPStatus,
  FixedDepositStatus,
} from '@prisma/client';

/**
 * Spec §9: ONE central function (`hasQualifyingActiveInvestment`) is the
 * single source of truth for "is this user currently a referrer?". It is
 * consumed by:
 *   - Referral code activation
 *   - Referral code validation at registration
 *   - Commission eligibility checks
 *
 * "Qualifying" is defined as: an investment that was approved (VERIFIED)
 * and has not been rejected or cancelled. A COMPLETED scheme still counts —
 * maturity is a successful outcome, not a disqualification. Otherwise a
 * customer whose FD matured would silently stop being a referrer, and their
 * upline's level unlocks would drop. SIP has no COMPLETED state, so its
 * check stays VERIFIED-only.
 *
 * Spec §13: if the referrer's qualifying investment stops, all NEW
 * commission earning stops — this service is what the scheduler checks
 * for every cycle.
 */
@Injectable()
export class InvestmentEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Spec §9: returns true when the user has at least one active verified
   * investment across any of the three product types. ADMIN is treated
   * as not-eligible (per spec §1, ADMIN must never be a referrer).
   */
  async hasQualifyingActiveInvestment(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) return false;
    if (user.role === 'ADMIN') return false;

    // Run all three product checks in parallel — each is a cheap indexed
    // COUNT, and the query planner can satisfy them concurrently.
    const [hasFund, hasSip, hasFd] = await Promise.all([
      this.prisma.investmentApplication.count({
        where: {
          userId,
          status: {
            in: [InvestmentStatus.VERIFIED, InvestmentStatus.COMPLETED],
          },
        },
      }),
      this.prisma.sIPForChildApplication.count({
        where: {
          userId,
          status: SIPStatus.VERIFIED,
        },
      }),
      this.prisma.fixedDepositApplication.count({
        where: {
          userId,
          status: {
            in: [FixedDepositStatus.VERIFIED, FixedDepositStatus.COMPLETED],
          },
        },
      }),
    ]);

    return hasFund + hasSip + hasFd > 0;
  }

  /**
   * Returns the count of a user's VERIFIED direct (L1) referrals — used
   * by the commission scheduler to determine which levels are unlocked
   * (spec §12). Indirect referrals do NOT count.
   *
   * "Verified" here means: the referred user themselves has at least one
   * qualifying investment (VERIFIED or COMPLETED), i.e. they have actually
   * participated in the platform (not merely registered).
   */
  async countVerifiedDirectReferrals(userId: string): Promise<number> {
    const relationships = await this.prisma.referralRelationship.findMany({
      where: { referrerId: userId },
      select: { referredUserId: true },
    });

    if (relationships.length === 0) return 0;

    let count = 0;
    // Each check is independent; run in parallel for the size we expect
    // (hundreds of direct referrals at most per the product spec).
    const checks = await Promise.all(
      relationships.map((r) =>
        this.hasQualifyingActiveInvestment(r.referredUserId),
      ),
    );
    for (const ok of checks) if (ok) count += 1;
    return count;
  }
}
