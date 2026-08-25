import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  InvestmentApplication,
  InvestmentScheme,
  InvestmentStatus,
  LedgerDirection,
  LedgerSourceType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

const PRISMA_ROUNDING = Prisma.Decimal.ROUND_DOWN;

/** Whole months between two dates (UTC, calendar-accurate). */
export function wholeMonthsBetween(from: Date, to: Date): number {
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  // A partial month only counts once the same day-of-month has been reached.
  if (
    to.getUTCDate() < from.getUTCDate() ||
    (to.getUTCDate() === from.getUTCDate() &&
      to.getUTCHours() < from.getUTCHours())
  ) {
    months -= 1;
  }
  return Math.max(0, months);
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // Clamp overflow (e.g. Jan 31 -> Feb 31 rolls into March).
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}

@Injectable()
export class InvestmentFundRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    data: {
      scheme: InvestmentScheme;
      amount: Prisma.Decimal;
      method: string;
      destination: string;
      submittedAt: Date;
    },
  ): Promise<InvestmentApplication> {
    return this.prisma.investmentApplication.create({
      data: {
        userId,
        ...data,
        status: InvestmentStatus.PENDING,
      },
    });
  }

  findById(id: string): Promise<Prisma.InvestmentApplicationGetPayload<{
    include: {
      user: {
        select: {
          id: true;
          firstName: true;
          lastName: true;
          email: true;
          clientId: true;
          balance: true;
          kycApplication: { select: { status: true } };
        };
      };
    };
  }> | null> {
    return this.prisma.investmentApplication.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            clientId: true,
            balance: true,
            kycApplication: { select: { status: true } },
          },
        },
      },
    });
  }

  /** Sum of every ROI rupee already credited for this application. */
  async totalRoiPaid(applicationId: string): Promise<Prisma.Decimal> {
    const agg = await this.prisma.investmentRoiPayout.aggregate({
      where: { applicationId },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? new Prisma.Decimal(0);
  }

  /** Total ROI credited per application for one user (for "My Investments"). */
  async roiTotalsForUser(
    userId: string,
  ): Promise<Record<string, Prisma.Decimal>> {
    const groups = await this.prisma.investmentRoiPayout.groupBy({
      by: ['applicationId'],
      where: { userId },
      _sum: { amount: true },
    });
    const totals: Record<string, Prisma.Decimal> = {};
    for (const g of groups) {
      totals[g.applicationId] = g._sum.amount ?? new Prisma.Decimal(0);
    }
    return totals;
  }

  /** Every ROI payout for a user, newest first, with its application scheme. */
  async payoutHistory(userId: string): Promise<
    Prisma.InvestmentRoiPayoutGetPayload<{
      include: { application: { select: { scheme: true } } };
    }>[]
  > {
    return this.prisma.investmentRoiPayout.findMany({
      where: { userId },
      include: { application: { select: { scheme: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByIdPlain(id: string): Promise<InvestmentApplication | null> {
    return this.prisma.investmentApplication.findUnique({ where: { id } });
  }

  async listMine(userId: string) {
    return this.prisma.investmentApplication.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async list(params: {
    status?: InvestmentStatus;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{
    items: Prisma.InvestmentApplicationGetPayload<{
      include: {
        user: {
          select: {
            firstName: true;
            lastName: true;
            email: true;
            clientId: true;
            kycApplication: { select: { status: true } };
          };
        };
      };
    }>[];
    total: number;
  }> {
    const where: Prisma.InvestmentApplicationWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.search
        ? {
            OR: [
              {
                user: {
                  email: { contains: params.search, mode: 'insensitive' },
                },
              },
              {
                user: {
                  clientId: { contains: params.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.investmentApplication.findMany({
        where,
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              clientId: true,
              kycApplication: { select: { status: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.investmentApplication.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Admin approve: conditional flip PENDING/UNDER_REVIEW -> VERIFIED and the
   * ROI cycle start (verifiedAt = lastRoiPaidAt = now) in one transaction.
   * No money moves here — the wallet was debited at submission time; approval
   * only starts earning. Two concurrent approvals cannot both match.
   */
  async approveAndStartCycle(
    row: InvestmentApplication,
    adminId: string,
  ): Promise<{
    conflicted: boolean;
    application: Prisma.InvestmentApplicationGetPayload<{
      include: {
        user: {
          select: {
            firstName: true;
            lastName: true;
            email: true;
            clientId: true;
            balance: true;
            kycApplication: { select: { status: true } };
          };
        };
      };
    }> | null;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const { count } = await tx.investmentApplication.updateMany({
        where: {
          id: row.id,
          status: {
            in: [InvestmentStatus.PENDING, InvestmentStatus.UNDER_REVIEW],
          },
        },
        data: {
          status: InvestmentStatus.VERIFIED,
          reviewedBy: adminId,
          reviewedAt: now,
          reviewNote: null,
          verifiedAt: now,
          lastRoiPaidAt: now,
        },
      });
      if (count !== 1) return { conflicted: true, application: null };

      await this.audit.log(
        {
          userId: adminId,
          action: AuditAction.APPROVE_INVESTMENT_FUND,
          metadata: {
            targetUserId: row.userId,
            applicationId: row.id,
            scheme: row.scheme,
            amount: row.amount.toString(),
            previousStatus: row.status,
            newStatus: InvestmentStatus.VERIFIED,
          },
        },
        tx,
      );

      // Re-read inside the transaction so the caller gets the row WITH
      // verifiedAt/lastRoiPaidAt and the user — required for the email.
      const application = await tx.investmentApplication.findUnique({
        where: { id: row.id },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              clientId: true,
              balance: true,
              kycApplication: { select: { status: true } },
            },
          },
        },
      });
      return { conflicted: false, application };
    });
  }

  /**
   * Admin reject: conditional flip to REJECTED with reason + wallet REFUND
   * (the submission debit is reversed) + ledger entry + audit, all atomic.
   */
  async rejectAndRefund(
    row: InvestmentApplication,
    adminId: string,
    reason: string,
  ): Promise<{ conflicted: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.investmentApplication.updateMany({
        where: {
          id: row.id,
          status: {
            in: [InvestmentStatus.PENDING, InvestmentStatus.UNDER_REVIEW],
          },
        },
        data: {
          status: InvestmentStatus.REJECTED,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          reviewNote: reason,
        },
      });
      if (count !== 1) return { conflicted: true };

      const user = await tx.user.update({
        where: { id: row.userId },
        data: { balance: { increment: row.amount } },
        select: { balance: true },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: row.userId,
          direction: LedgerDirection.CREDIT,
          amount: row.amount,
          balanceAfter: user.balance,
          sourceType: LedgerSourceType.INVESTMENT_REFUND,
          sourceId: row.id,
        },
      });
      await this.audit.log(
        {
          userId: adminId,
          action: AuditAction.REJECT_INVESTMENT_FUND,
          metadata: {
            targetUserId: row.userId,
            applicationId: row.id,
            scheme: row.scheme,
            amount: row.amount.toString(),
            refund: true,
            previousStatus: row.status,
            newStatus: InvestmentStatus.REJECTED,
            reason,
          },
        },
        tx,
      );
      return { conflicted: false };
    });
  }

  /**
   * VERIFIED applications whose ROI may have accrued (the service computes
   * exact due periods from verifiedAt/lastRoiPaidAt).
   */
  async findDueForRoi(): Promise<InvestmentApplication[]> {
    return this.prisma.investmentApplication.findMany({
      where: {
        status: InvestmentStatus.VERIFIED,
        verifiedAt: { not: null },
        lastRoiPaidAt: { not: null },
      },
    });
  }

  /**
   * Credits `periods` monthly ROI payouts for one application atomically:
   * balance increment + ledger entry + payout record per month, then advances
   * lastRoiPaidAt. Idempotent — safe against double-run within a month.
   */
  async payRoi(
    application: InvestmentApplication,
    periods: Array<{ start: Date; end: Date }>,
    roiPercent: number,
  ): Promise<number> {
    if (periods.length === 0) return 0;

    return this.prisma.$transaction(async (tx) => {
      let credited = 0;
      for (const period of periods) {
        const roi = application.amount
          .mul(roiPercent)
          .div(100)
          .toDecimalPlaces(2, PRISMA_ROUNDING);
        if (roi.lte(0)) continue;

        const user = await tx.user.update({
          where: { id: application.userId },
          data: { balance: { increment: roi } },
          select: { balance: true },
        });
        await tx.ledgerEntry.create({
          data: {
            userId: application.userId,
            direction: 'CREDIT',
            amount: roi,
            balanceAfter: user.balance,
            sourceType: 'INVESTMENT_ROI',
            sourceId: application.id,
          },
        });
        await tx.investmentRoiPayout.create({
          data: {
            applicationId: application.id,
            userId: application.userId,
            amount: roi,
            roiPercent: new Prisma.Decimal(roiPercent),
            periodStart: period.start,
            periodEnd: period.end,
          },
        });
        await this.audit.log(
          {
            action: AuditAction.INVESTMENT_ROI_CREDIT,
            metadata: {
              targetUserId: application.userId,
              applicationId: application.id,
              scheme: application.scheme,
              roiAmount: roi.toString(),
              roiPercent,
              periodStart: period.start.toISOString(),
              periodEnd: period.end.toISOString(),
            },
          },
          tx,
        );
        credited += 1;
      }

      await tx.investmentApplication.update({
        where: { id: application.id },
        data: { lastRoiPaidAt: periods[periods.length - 1].end },
      });
      return credited;
    });
  }

  async setStatus(
    id: string,
    status: InvestmentStatus,
    reviewedBy: string,
    note?: string | null,
  ): Promise<InvestmentApplication> {
    return this.prisma.investmentApplication.update({
      where: { id },
      data: {
        status,
        reviewedBy,
        reviewedAt: new Date(),
        ...(note !== undefined ? { reviewNote: note } : {}),
      },
    });
  }

  async getUserBalance(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    return user?.balance ?? 0;
  }

  async getUserWithPasswordHash(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        balance: true,
        passwordHash: true,
      },
    });
  }

  async findActiveByUserAndScheme(userId: string, scheme: InvestmentScheme) {
    return this.prisma.investmentApplication.findFirst({
      where: {
        userId,
        scheme,
        status: {
          in: [
            InvestmentStatus.PENDING,
            InvestmentStatus.UNDER_REVIEW,
            InvestmentStatus.VERIFIED,
          ],
        },
      },
    });
  }
}
