import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReferralCodeStatus, UserStatus, Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ReferralRepository } from './referral.repository';
import { ReferralCodeService } from './referral-code.service';
import { InvestmentEligibilityService } from './investment-eligibility.service';
import { CommissionConfigService } from './commission-config.service';
import { KycService } from '../kyc/kyc.service';
import { AuditService } from '../audit/audit.service';
import { generateClientId } from '../../common/utils/client-id.util';

/**
 * Spec §1–§4: referral domain service.
 *
 * Responsibilities:
 *  - Validate a referral code (server-side, no info leak).
 *  - Open the registration transaction (user + direct relationship).
 *  - Generate a referral code on first verified investment (idempotent).
 *  - Recompute a user's `referralCodeStatus` whenever their investments
 *    change (spec §11).
 *  - Surface eligibility / stats / tree / commission history to the
 *    controller layer.
 *
 * Spec §1: ADMIN is excluded EXPLICITLY via `role === 'ADMIN'` checks,
 * never via `referredById === null` (which would also match SUPER_USER).
 */
@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly referralRepo: ReferralRepository,
    private readonly codeService: ReferralCodeService,
    private readonly eligibility: InvestmentEligibilityService,
    private readonly config: CommissionConfigService,
    private readonly kycService: KycService,
    private readonly audit: AuditService,
  ) {}

  // ─── Public: validation ─────────────────────────────────────────────────

  /**
   * Spec §4 + §22: rate-limited, returns a generic boolean so the public
   * form cannot enumerate codes. The full first/last name is only
   * returned when the code is valid AND currently usable.
   */
  async validateReferralCode(code: string): Promise<{
    valid: boolean;
    referrerName?: string;
  }> {
    if (!code || typeof code !== 'string') return { valid: false };

    const referrer = await this.referralRepo.findActiveReferrerByCode(code);
    if (!referrer) return { valid: false };

    return {
      valid: true,
      referrerName: `${referrer.firstName} ${referrer.lastName}`.trim(),
    };
  }

  // ─── Auth → registration hook (called from AuthService.register) ───────

  /**
   * Spec §4: opens a single transaction that:
   *   1. Re-validates the referral code under the same isolation as the
   *      user insert (avoids a TOCTOU where a code is suspended between
   *      validate and commit).
   *   2. Creates the user (no referral code on the user yet — spec §2).
   *   3. Records the direct relationship.
   *
   * Returns the freshly-created user.
   *
   * The caller (AuthService) is responsible for the rest of the user
   * creation (password hash, consent record, email verification email).
   * We accept `userData` and `referredById` so this service does not
   * need to know about Argon2 / SMTP.
   */
  async registerWithReferral(params: {
    firstName: string;
    lastName: string;
    email: string;
    passwordHash: string;
    marketingEmails: boolean;
    referralCode: string;
  }): Promise<{
    user: { id: string; firstName: string; lastName: string; email: string; clientId: string | null };
  }> {
    const { referralCode } = params;
    if (!referralCode) {
      // Spec §4: every normal user must come in via a valid code.
      throw new BadRequestException('Invalid or unavailable referral code.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Lock the referrer row for the duration of the transaction so
      // a concurrent deactivation cannot slip in between validate and
      // create.
      const referrer = await tx.user.findFirst({
        where: {
          referralCode,
          role: { not: Role.ADMIN },
          referralCodeStatus: ReferralCodeStatus.ACTIVE,
        },
        select: {
          id: true,
          status: true,
        },
      });
      if (!referrer || referrer.status !== UserStatus.ACTIVE) {
        throw new BadRequestException('Invalid or unavailable referral code.');
      }

      // Spec §4 #7: referrer must have a qualifying investment at the
      // moment of registration — not merely "has ever had one".
      const eligible = await this.eligibility.hasQualifyingActiveInvestment(
        referrer.id,
      );
      if (!eligible) {
        throw new BadRequestException('Invalid or unavailable referral code.');
      }

      // Spec §4 #8: prevent self-referral.
      // The new user is created below; we cannot self-check until then,
      // but by definition the referrer is a different, pre-existing user.

      // Spec §22 #2: cycle detection. The new user has no inbound
      // relationships, so a cycle is impossible at the moment of
      // creation — but we keep the hook in place for any future bulk
      // import paths.

      const existingEmail = await tx.user.findUnique({
        where: { email: params.email.toLowerCase().trim() },
        select: { id: true },
      });
      if (existingEmail) {
        throw new ConflictException(
          'An account with this email already exists.',
        );
      }

      const created = await tx.user.create({
        data: {
          firstName: params.firstName,
          lastName: params.lastName,
          email: params.email.toLowerCase().trim(),
          passwordHash: params.passwordHash,
          // No referralCode on registration (spec §2).
          // Generate clientId at registration so user gets it immediately.
          clientId: await this.generateUniqueClientId(tx),
          referredById: referrer.id,
          role: Role.USER,
          userType: 'pennytor_user',
          status: UserStatus.PENDING_VERIFICATION,
          emailVerified: false,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          clientId: true,
        },
      });

      // Spec §7: direct relationship — UNIQUE on referredUserId guarantees
      // a user can have at most one direct referrer.
      await tx.referralRelationship.create({
        data: {
          referrerId: referrer.id,
          referredUserId: created.id,
        },
      });

      await tx.userConsent.create({
        data: {
          userId: created.id,
          termsAccepted: true,
          termsAcceptedAt: new Date(),
          privacyPolicyAccepted: true,
          privacyPolicyAcceptedAt: new Date(),
          marketingEmails: params.marketingEmails,
        },
      });

      await this.audit.log(
        {
          userId: created.id,
          action: 'REGISTER',
          metadata: { viaReferralCode: referralCode, referrerId: referrer.id },
        },
        tx,
      );

      return { user: { id: created.id, firstName: created.firstName, lastName: created.lastName, email: created.email, clientId: created.clientId } };
    });
  }

  // ─── Investment hooks (spec §10, §11) ─────────────────────────────────

  /**
   * Called by InvestmentFundService / SIPForChildService / FixedDeposit
   * admin-approve paths when a user's investment is verified.
   *
   * Idempotent:
   *  - If the user already has a referral code, do nothing.
   *  - If the user has at least one qualifying active verified
   *    investment AFTER this approval, set status to ACTIVE.
   *  - Otherwise leave the code NULL (spec §2: code exists only after
   *    at least one verified investment).
   */
  async onInvestmentVerified(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          referralCode: true,
          referredById: true,
        },
      });
      if (!user) return;
      if (user.role === Role.ADMIN) return; // spec §1 — never a referrer

      // Spec §2: code generated only on first verified investment.
      if (!user.referralCode) {
        const code = await this.codeService.generateUnique();
        await tx.user.update({
          where: { id: userId },
          data: { referralCode: code },
        });
        await this.audit.log(
          {
            userId,
            action: 'REFERRAL_CODE_GENERATED',
            metadata: { code },
          },
          tx,
        );
      }

      // Spec §3: status = ACTIVE iff at least one qualifying investment.
      const eligible =
        await this.eligibility.hasQualifyingActiveInvestment(userId);
      const newStatus = eligible
        ? ReferralCodeStatus.ACTIVE
        : ReferralCodeStatus.INACTIVE;

      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { referralCodeStatus: true },
      });
      if (current?.referralCodeStatus !== newStatus) {
        await tx.user.update({
          where: { id: userId },
          data: { referralCodeStatus: newStatus },
        });
        await this.audit.log(
          {
            userId,
            action:
              newStatus === ReferralCodeStatus.ACTIVE
                ? 'REFERRAL_CODE_ACTIVATED'
                : 'REFERRAL_CODE_DEACTIVATED',
            metadata: {
              previous: current?.referralCodeStatus,
              next: newStatus,
            },
          },
          tx,
        );
      }
    });
  }

  /**
   * Called when a user's investment becomes ineligible (rejected,
   * cancelled, completed). If they still have another qualifying
   * investment, the code remains ACTIVE; otherwise INACTIVE.
   * Spec §11: never delete the code, never delete relationships.
   */
  async onInvestmentDeactivated(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, referralCode: true },
    });
    if (!user || user.role === Role.ADMIN) return;
    if (!user.referralCode) return;

    const eligible =
      await this.eligibility.hasQualifyingActiveInvestment(userId);
    const newStatus = eligible
      ? ReferralCodeStatus.ACTIVE
      : ReferralCodeStatus.INACTIVE;

    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCodeStatus: true },
    });
    if (current?.referralCodeStatus !== newStatus) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { referralCodeStatus: newStatus },
      });
      await this.audit.log({
        userId,
        action:
          newStatus === ReferralCodeStatus.ACTIVE
            ? 'REFERRAL_CODE_ACTIVATED'
            : 'REFERRAL_CODE_DEACTIVATED',
        metadata: {
          previous: current?.referralCodeStatus,
          next: newStatus,
          reason: 'investment_deactivated',
        },
      });
    }
  }

  // ─── User-facing reads (spec §26) ──────────────────────────────────────

  async getMyEligibility(userId: string): Promise<{
    canRefer: boolean;
    reason: string | null;
    referralCode: string | null;
    referralCodeStatus: ReferralCodeStatus | null;
    kycStatus: "VERIFIED" | "PENDING" | "REJECTED" | "NOT_STARTED";
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, referralCode: true, referralCodeStatus: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const kycStatus = await this.kycService.getKycStatus(userId);

    if (user.role === Role.ADMIN) {
      return {
        canRefer: false,
        reason: 'Admin accounts are excluded from the referral program.',
        referralCode: null,
        referralCodeStatus: null,
        kycStatus,
      };
    }
    if (kycStatus !== "VERIFIED") {
      const reasonMap = {
        NOT_STARTED:
          'Complete KYC verification before you can participate in the referral program.',
        PENDING:
          'Your KYC application is under review. You will be able to refer once it is verified.',
        REJECTED:
          'Your KYC application was rejected. Please contact support to resubmit.',
      };
      return {
        canRefer: false,
        reason: reasonMap[kycStatus],
        referralCode: user.referralCode ?? null,
        referralCodeStatus: user.referralCodeStatus ?? null,
        kycStatus,
      };
    }
    if (!user.referralCode) {
      return {
        canRefer: false,
        reason:
          'Make an investment to unlock your referral program. Once your investment is verified, your referral code will be generated.',
        referralCode: null,
        referralCodeStatus: null,
        kycStatus,
      };
    }
    if (user.referralCodeStatus === ReferralCodeStatus.INACTIVE) {
      return {
        canRefer: false,
        reason:
          'Your referral code is currently inactive. Activate an investment to start referring again.',
        referralCode: user.referralCode,
        referralCodeStatus: user.referralCodeStatus,
        kycStatus,
      };
    }
    return {
      canRefer: true,
      reason: null,
      referralCode: user.referralCode,
      referralCodeStatus: user.referralCodeStatus,
      kycStatus,
    };
  }

  async getMyCode(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true, referralCodeStatus: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      referralCode: user.referralCode,
      referralCodeStatus: user.referralCodeStatus,
    };
  }

  /**
   * Spec §26: returns direct + verified direct counts, current unlocked
   * commission level, current rates, and total / monthly earnings.
   */
  async getMyStats(userId: string) {
    const directCount = await this.referralRepo.countDirectReferrals(userId);
    const verifiedDirectCount =
      await this.eligibility.countVerifiedDirectReferrals(userId);

    const cfg = await this.config.get();
    const maxLevel = await this.config.maxUnlockedLevel(verifiedDirectCount);

    const kycStatus = await this.kycService.getKycStatus(userId);

    const rates = {
      l1: Number(cfg.l1RatePercent),
      l2: Number(cfg.l2RatePercent),
      l3: Number(cfg.l3RatePercent),
      l4: Number(cfg.l4RatePercent),
      l5: Number(cfg.l5RatePercent),
    };

    const [totalAgg, monthAgg] = await Promise.all([
      this.prisma.referralCommission.aggregate({
        where: {
          referrerId: userId,
          status: { in: ['PAID', 'CALCULATED', 'FROZEN'] },
        },
        _sum: { commissionAmount: true },
      }),
      this.monthlyEarningsFor(userId),
    ]);

    return {
      directReferrals: directCount,
      verifiedDirectReferrals: verifiedDirectCount,
      currentUnlockedLevel: maxLevel,
      rates,
      kycStatus,
      // The thresholds used to compute `currentUnlockedLevel` —
      // surfaced so the UI can show "X more verified direct
      // referrals to unlock Level N" without hard-coding the
      // spec constants. Spec §12: L1 unlocks at 0; L2 = 3;
      // L3 = 6; L4 = 9; L5 = 12.
      thresholds: {
        l2: cfg.l2MinDirectVerified,
        l3: cfg.l3MinDirectVerified,
        l4: cfg.l4MinDirectVerified,
        l5: cfg.l5MinDirectVerified,
      },
      maxDepth: cfg.maxDepth,
      totalEarnings: (
        totalAgg._sum.commissionAmount ?? new Prisma.Decimal(0)
      ).toString(),
      monthlyEarnings: monthAgg,
    };
  }

  private async monthlyEarningsFor(userId: string): Promise<string> {
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();
    const agg = await this.prisma.referralCommission.aggregate({
      where: {
        referrerId: userId,
        commissionMonth: month,
        commissionYear: year,
        status: { in: ['PAID', 'CALCULATED', 'FROZEN'] },
      },
      _sum: { commissionAmount: true },
    });
    return (agg._sum.commissionAmount ?? new Prisma.Decimal(0)).toString();
  }

  /**
   * Spec §25 + §26: normal users see L1–L5 only. The depth cap is
   * hard-baked here so the backend itself never returns L6+ to a USER.
   * The admin path uses a separate method with a higher cap.
   */
  async getMyTree(userId: string) {
    const tree = await this.referralRepo.getTreeBounded(userId, 5);

    const nodeIds: string[] = [];
    const walk = (nodes: any[]) => {
      for (const node of nodes) {
        nodeIds.push(node.id);
        walk(node.children ?? []);
      }
    };
    walk(tree);

    if (nodeIds.length === 0) return tree;

    const sums = await this.prisma.referralCommission.groupBy({
      by: ['referredUserId'],
      where: {
        referrerId: userId,
        referredUserId: { in: nodeIds },
        status: { in: ['PAID', 'CALCULATED', 'FROZEN'] },
      },
      _sum: { commissionAmount: true },
    });

    const byReferred = new Map(
      sums.map((s) => [s.referredUserId, (s._sum.commissionAmount ?? new Prisma.Decimal(0)).toString()]),
    );

    const attach = (nodes: any[]) => {
      for (const node of nodes) {
        node.totalCommission = byReferred.get(node.id) ?? '0';
        attach(node.children ?? []);
      }
    };
    attach(tree);

    return tree;
  }

  async getMyCommissionHistory(userId: string, page: number, pageSize: number) {
    const [items, total] = await Promise.all([
      this.prisma.referralCommission.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          level: true,
          investmentAmountSnapshot: true,
          commissionRateSnapshot: true,
          commissionAmount: true,
          commissionMonth: true,
          commissionYear: true,
          status: true,
          createdAt: true,
          paidAt: true,
          reversedAt: true,
          referredUserId: true,
          investmentId: true,
        },
      }),
      this.prisma.referralCommission.count({ where: { referrerId: userId } }),
    ]);
    return { items, total, page, pageSize };
  }

  async getMyCommissionSummary(userId: string) {
    // Yearly and monthly aggregates, scoped to non-reversed records.
    const yearlyRows = await this.prisma.referralCommission.groupBy({
      by: ['commissionYear'],
      where: {
        referrerId: userId,
        status: { in: ['PAID', 'CALCULATED', 'FROZEN'] },
      },
      _sum: { commissionAmount: true },
      _count: true,
      orderBy: { commissionYear: 'desc' },
    });
    const monthlyRows = await this.prisma.referralCommission.groupBy({
      by: ['commissionYear', 'commissionMonth'],
      where: {
        referrerId: userId,
        status: { in: ['PAID', 'CALCULATED', 'FROZEN'] },
      },
      _sum: { commissionAmount: true },
      _count: true,
      orderBy: [{ commissionYear: 'desc' }, { commissionMonth: 'desc' }],
    });

    return {
      yearly: yearlyRows.map((r) => ({
        year: r.commissionYear,
        total: (r._sum.commissionAmount ?? new Prisma.Decimal(0)).toString(),
        count: r._count,
      })),
      monthly: monthlyRows.map((r) => ({
        year: r.commissionYear,
        month: r.commissionMonth,
        total: (r._sum.commissionAmount ?? new Prisma.Decimal(0)).toString(),
        count: r._count,
      })),
    };
  }

  // ─── SUPER_USER creation (spec §5) ─────────────────────────────────────

  /**
   * Creates a SUPER_USER outside the public registration flow. SUPER_USER
   * has no referrer (referredById = null), no referral code at creation,
   * and must go through the same investment-verification path to get one.
   *
   * Exposed via the ADMIN-only `POST /admin/super-users` route. Also
   * used by the standalone `user-generation/seed-super-user.js`
   * script for environments where there is no live API (e.g. ops
   * bootstrapping a fresh database before the app is deployed).
   */
  async createSuperUser(params: {
    firstName: string;
    lastName: string;
    email: string;
    passwordHash: string;
    marketingEmails: boolean;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { email: params.email.toLowerCase().trim() },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          'An account with this email already exists.',
        );
      }

      const created = await tx.user.create({
        data: {
          firstName: params.firstName,
          lastName: params.lastName,
          email: params.email.toLowerCase().trim(),
          passwordHash: params.passwordHash,
          role: Role.USER,
          userType: 'super_user',
          // Spec §5: SUPER_USER has no referrer at creation.
          referredById: null,
          // Spec §2: no referral code at creation.
          referralCode: null,
          referralCodeStatus: null,
          status: UserStatus.ACTIVE,
          emailVerified: true,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      });

      await tx.userConsent.create({
        data: {
          userId: created.id,
          termsAccepted: true,
          termsAcceptedAt: new Date(),
          privacyPolicyAccepted: true,
          privacyPolicyAcceptedAt: new Date(),
          marketingEmails: params.marketingEmails,
        },
      });

      return { user: created };
    });
  }

  /**
   * Generates a unique clientId using the shared utility and checks
   * against the database within the given transaction to avoid collisions.
   */
  private async generateUniqueClientId(tx: Prisma.TransactionClient): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const clientId = generateClientId();
      const existing = await tx.user.findUnique({
        where: { clientId },
        select: { id: true },
      });
      if (!existing) return clientId;
    }
    throw new Error('Failed to generate a unique Client ID');
  }
}
