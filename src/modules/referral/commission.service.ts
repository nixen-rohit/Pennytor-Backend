import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  CommissionStatus,
  LedgerDirection,
  LedgerSourceType,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CommissionConfigService } from './commission-config.service';
import { InvestmentEligibilityService } from './investment-eligibility.service';
import { AuditService } from '../audit/audit.service';

/**
 * Spec §14, §18, §20, §21: commission calculation + persistence.
 *
 * - Every commission is stored with a SNAPSHOT of the rate, the
 *   investment amount, the qualifying-direct count, and the calculation
 *   month/year (spec §20). The row is never re-derived from current
 *   config or current balances.
 * - Wallet credit, ledger entry, and commission row are inserted in ONE
 *   transaction (spec §18). If any one fails, the wallet is not credited.
 * - Idempotency is enforced by a unique constraint
 *   `(referrerId, referredUserId, investmentId, level, commissionMonth,
 *   commissionYear)` (spec §8, §17). Duplicate scheduler runs hit a
 *   `P2002` and are silently skipped (never an error to the caller).
 * - Reversal creates a SECOND row with `reversalOfId` pointing at the
 *   original (spec §21). The original is never deleted.
 */
@Injectable()
export class CommissionService {
  private readonly logger = new Logger(CommissionService.name);
  private static readonly ROUNDING = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: CommissionConfigService,
    private readonly eligibility: InvestmentEligibilityService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Calculates and records a single commission event. Returns the row
   * id, or `null` when the (referrer, referred, investment, level,
   * month, year) tuple was already paid — i.e. a duplicate scheduler
   * run. Never throws on duplicates; only on genuine failures.
   */
  async calculateAndRecord(params: {
    referrerId: string;
    referredUserId: string;
    investmentId: string;
    investmentAmount: Prisma.Decimal;
    level: number;
    commissionMonth: number;
    commissionYear: number;
  }): Promise<{ id: string; amount: Prisma.Decimal } | null> {
    const {
      referrerId,
      referredUserId,
      investmentId,
      level,
      commissionMonth,
      commissionYear,
    } = params;
    if (referrerId === referredUserId) return null;

    return this.prisma.$transaction(async (tx) => {
      // ADMIN guard (spec §1). Even if the scheduler somehow handed us
      // an ADMIN, we never pay them.
      const referrer = await tx.user.findUnique({
        where: { id: referrerId },
        select: { id: true, role: true, status: true },
      });
      if (!referrer || referrer.role === Role.ADMIN) return null;

      // Idempotency: if a row already exists for this exact tuple, skip.
      // The DB unique constraint will also reject an insert; doing the
      // pre-check lets us return `null` cleanly without throwing.
      const existing = await tx.referralCommission.findUnique({
        where: {
          referral_commission_idempotency: {
            referrerId,
            referredUserId,
            investmentId,
            level,
            commissionMonth,
            commissionYear,
          },
        },
        select: { id: true, status: true },
      });
      if (existing) return null;

      // Snapshot the rate AND the qualifying-direct count at this
      // moment (spec §20). These are stored on the row, never recomputed.
      const verifiedDirectCount =
        await this.eligibility.countVerifiedDirectReferrals(referrerId);
      const ratePercent = await this.config.getRatePercent(level);

      // Rate is a percent (0.5 = 0.5%); commission = amount * rate / 100.
      // Decimal arithmetic only — never float (spec §19).
      const raw = params.investmentAmount.mul(ratePercent).div(100);
      const amount = raw.toDecimalPlaces(
        CommissionService.ROUNDING,
        Prisma.Decimal.ROUND_HALF_UP,
      );
      if (amount.lte(0)) return null;

      const inserted = await tx.referralCommission.create({
        data: {
          referrerId,
          referredUserId,
          investmentId,
          level,
          investmentAmountSnapshot: params.investmentAmount,
          commissionRateSnapshot: ratePercent,
          qualifyingDirectReferralCount: verifiedDirectCount,
          commissionAmount: amount,
          commissionMonth,
          commissionYear,
          status: CommissionStatus.PAID,
          paidAt: new Date(),
        },
        select: { id: true, commissionAmount: true },
      });

      // Credit the wallet (spec §18 — atomic with the row insert).
      const updated = await tx.user.update({
        where: { id: referrerId },
        data: { balance: { increment: amount } },
        select: { balance: true },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: referrerId,
          direction: LedgerDirection.CREDIT,
          amount,
          balanceAfter: updated.balance,
          sourceType: LedgerSourceType.REFERRAL_COMMISSION,
          sourceId: inserted.id,
        },
      });

      await this.audit.log(
        {
          userId: referrerId,
          action: 'REFERRAL_COMMISSION_PAID',
          metadata: {
            commissionId: inserted.id,
            referredUserId,
            investmentId,
            level,
            amount: amount.toString(),
            commissionMonth,
            commissionYear,
            snapshotRate: ratePercent.toString(),
            qualifyingDirectCount: verifiedDirectCount,
          },
        },
        tx,
      );

      return { id: inserted.id, amount: inserted.commissionAmount };
    });
  }

  /**
   * Spec §21: reversal. Creates a SECOND row that debits the wallet
   * by the same amount; the original is never deleted or edited. If
   * the commission was already reversed, returns the existing reversal
   * row id (idempotent).
   */
  async reverse(commissionId: string, actorId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.referralCommission.findUnique({
        where: { id: commissionId },
        select: {
          id: true,
          referrerId: true,
          commissionAmount: true,
          status: true,
          reversalOfId: true,
        },
      });
      if (!original) throw new NotFoundException('Commission not found');
      if (original.status === CommissionStatus.REVERSED) {
        // Idempotent: a reversal already exists.
        const existing = await tx.referralCommission.findUnique({
          where: { reversalOfId: original.id },
          select: { id: true },
        });
        return { reversalId: existing?.id ?? null };
      }

      // Create the reversal row.
      const reversal = await tx.referralCommission.create({
        data: {
          referrerId: original.referrerId,
          referredUserId: '00000000-0000-0000-0000-000000000000', // sentinel — never matched by tree walks
          investmentId: original.id,
          level: -1,
          investmentAmountSnapshot: original.commissionAmount,
          commissionRateSnapshot: new Prisma.Decimal(0),
          qualifyingDirectReferralCount: 0,
          commissionAmount: original.commissionAmount.neg(),
          commissionMonth: 0,
          commissionYear: 0,
          status: CommissionStatus.REVERSED,
          reversedAt: new Date(),
          reversalOfId: original.id,
        },
        select: { id: true },
      });

      // Mark the original as REVERSED (we never delete it).
      await tx.referralCommission.update({
        where: { id: original.id },
        data: {
          status: CommissionStatus.REVERSED,
          reversedAt: new Date(),
        },
      });

      // Debit the wallet (the original credit is undone) and write a
      // reversal ledger entry (spec §21).
      const updated = await tx.user.update({
        where: { id: original.referrerId },
        data: { balance: { decrement: original.commissionAmount } },
        select: { balance: true },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: original.referrerId,
          direction: LedgerDirection.DEBIT,
          amount: original.commissionAmount,
          balanceAfter: updated.balance,
          sourceType: LedgerSourceType.REFERRAL_COMMISSION_REVERSAL,
          sourceId: reversal.id,
        },
      });

      await this.audit.log(
        {
          userId: actorId,
          action: 'REFERRAL_COMMISSION_REVERSED',
          metadata: {
            commissionId: original.id,
            reversalId: reversal.id,
            amount: original.commissionAmount.toString(),
            reason,
          },
        },
        tx,
      );

      return { reversalId: reversal.id };
    });
  }

  /** Spec §26: admin can freeze a commission pending review. */
  async freeze(commissionId: string, actorId: string) {
    const row = await this.prisma.referralCommission.findUnique({
      where: { id: commissionId },
      select: { id: true, status: true },
    });
    if (!row) throw new NotFoundException('Commission not found');
    if (row.status === CommissionStatus.REVERSED) {
      throw new NotFoundException('Cannot freeze a reversed commission');
    }
    const updated = await this.prisma.referralCommission.update({
      where: { id: commissionId },
      data: { status: CommissionStatus.FROZEN, frozenAt: new Date() },
      select: { id: true, status: true },
    });
    await this.audit.log({
      userId: actorId,
      action: 'REFERRAL_COMMISSION_FROZEN',
      metadata: { commissionId },
    });
    return updated;
  }
}
