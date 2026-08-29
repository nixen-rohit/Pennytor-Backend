import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma, SIPPlanId, SIPStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class SIPForChildRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    data: {
      scheme: SIPPlanId;
      amount: Prisma.Decimal;
      method: string;
      destination: string;
      submittedAt: Date;
    },
  ) {
    return this.prisma.sIPForChildApplication.create({
      data: {
        userId,
        ...data,
        status: SIPStatus.PENDING,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.sIPForChildApplication.findUnique({
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
        premiums: { orderBy: { monthNumber: 'asc' } },
      },
    });
  }

  async listMine(userId: string) {
    return this.prisma.sIPForChildApplication.findMany({
      where: { userId },
      include: {
        premiums: { orderBy: { monthNumber: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async list(params: {
    status?: SIPStatus;
    search?: string;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.SIPForChildApplicationWhereInput = {
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
      this.prisma.sIPForChildApplication.findMany({
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
          premiums: { orderBy: { monthNumber: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.sIPForChildApplication.count({ where }),
    ]);

    return { items, total };
  }

  async findActiveByUserAndScheme(userId: string, scheme: string) {
    return this.prisma.sIPForChildApplication.findFirst({
      where: {
        userId,
        scheme: scheme as any,
        status: {
          in: [SIPStatus.PENDING, SIPStatus.VERIFIED, SIPStatus.UNDER_REVIEW],
        },
      },
    });
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

  /**
   * Admin approve: flip PENDING/UNDER_REVIEW -> VERIFIED.
   * No money moves here — money is collected via monthly premiums.
   */
  async approveAndStartCycle(
    row: any,
    adminId: string,
  ): Promise<{ conflicted: boolean; application: any }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const { count } = await tx.sIPForChildApplication.updateMany({
        where: {
          id: row.id,
          status: {
            in: [SIPStatus.PENDING, SIPStatus.UNDER_REVIEW],
          },
        },
        data: {
          status: SIPStatus.VERIFIED,
          reviewedBy: adminId,
          reviewedAt: now,
          reviewNote: null,
          verifiedAt: now,
        },
      });
      if (count !== 1) return { conflicted: true, application: null };

      const application = await tx.sIPForChildApplication.findUnique({
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
          premiums: { orderBy: { monthNumber: 'asc' } },
        },
      });
      return { conflicted: false, application };
    });

    if (!result.conflicted) {
      await this.audit.log({
        userId: adminId,
        action: 'APPROVE_SIP_FOR_CHILD' as any,
        metadata: {
          targetUserId: row.userId,
          applicationId: row.id,
          scheme: row.scheme,
          amount: row.amount.toString(),
          previousStatus: row.status,
          newStatus: SIPStatus.VERIFIED,
        },
      });
    }

    return result;
  }

  /**
   * Admin reject: flip to REJECTED + refund any paid premiums.
   */
  async rejectAndRefund(
    row: any,
    adminId: string,
    reason: string,
  ): Promise<{ conflicted: boolean }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.sIPForChildApplication.updateMany({
        where: {
          id: row.id,
          status: {
            in: [SIPStatus.PENDING, SIPStatus.UNDER_REVIEW],
          },
        },
        data: {
          status: SIPStatus.REJECTED,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          reviewNote: reason,
        },
      });
      if (count !== 1) return { conflicted: true };

      // Refund any paid premiums
      const paidPremiums = await tx.sIPForChildPremium.findMany({
        where: { applicationId: row.id, status: 'PAID' },
      });

      let totalRefund = new Prisma.Decimal(0);
      for (const premium of paidPremiums) {
        totalRefund = totalRefund.add(premium.amount);
        await tx.sIPForChildPremium.update({
          where: { id: premium.id },
          data: { status: 'REFUNDED' },
        });
      }

      if (totalRefund.greaterThan(0)) {
        const user = await tx.user.update({
          where: { id: row.userId },
          data: { balance: { increment: totalRefund } },
          select: { balance: true },
        });

        await tx.ledgerEntry.create({
          data: {
            userId: row.userId,
            direction: 'CREDIT',
            amount: totalRefund,
            balanceAfter: user.balance,
            sourceType: 'SIP_FOR_CHILD_REFUND' as any,
            sourceId: row.id,
          },
        });
      }

      return { conflicted: false, refund: totalRefund.toString() };
    });

    if (!result.conflicted) {
      await this.audit.log({
        userId: adminId,
        action: 'REJECT_SIP_FOR_CHILD' as any,
        metadata: {
          targetUserId: row.userId,
          applicationId: row.id,
          scheme: row.scheme,
          amount: row.amount.toString(),
          refund: result.refund,
          previousStatus: row.status,
          newStatus: SIPStatus.REJECTED,
          reason,
        },
      });
    }

    return { conflicted: result.conflicted };
  }

  /**
   * Record a premium payment and update application counters.
   * Returns the next month number or null if application is complete/rejected.
   */
  async payPremium(
    applicationId: string,
    userId: string,
    amount: Prisma.Decimal,
    monthNumber: number,
  ): Promise<{ success: boolean; nextMonth: number | null; balanceAfter: Prisma.Decimal }> {
    return this.prisma.$transaction(async (tx) => {
      // Race-condition guard: re-check inside the transaction.
      // The DB unique constraint on (applicationId, monthNumber) is the
      // final backstop, but this gives a clear error message.
      const existingPremium = await tx.sIPForChildPremium.findUnique({
        where: {
          sip_premium_app_month_unique: {
            applicationId,
            monthNumber,
          },
        },
      });
      if (existingPremium) {
        throw new ConflictException('Premium for this month has already been paid');
      }

      // Re-check application status inside the transaction (race: pay after reject)
      const appCheck = await tx.sIPForChildApplication.findUnique({
        where: { id: applicationId },
        select: { status: true },
      });
      if (!appCheck || appCheck.status !== SIPStatus.VERIFIED) {
        throw new BadRequestException('Application is no longer active');
      }

      // Re-check wallet balance inside the transaction (prevents TOCTOU)
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true },
      });
      if (!user || user.balance.lessThan(amount)) {
        throw new BadRequestException('Insufficient wallet balance');
      }

      // Atomic: debit wallet
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: amount } },
        select: { balance: true },
      });

      // Record the premium
      await tx.sIPForChildPremium.create({
        data: {
          applicationId,
          userId,
          amount,
          monthNumber,
          status: 'PAID',
          paidAt: new Date(),
        },
      });

      // Update application counters
      const app = await tx.sIPForChildApplication.findUnique({
        where: { id: applicationId },
      });

      if (!app) throw new NotFoundException('Application not found');

      const newMonthsPaid = app.monthsPaid + 1;
      const nextMonth = monthNumber + 1;
      const isComplete = nextMonth > app.totalMonths;

      await tx.sIPForChildApplication.update({
        where: { id: applicationId },
        data: {
          monthsPaid: newMonthsPaid,
          monthsMissed: 0,
          lastPaidAt: new Date(),
          startedAt: app.startedAt || new Date(),
          nextPaymentDue: isComplete ? null : this.getNextDueDate(new Date()),
          status: isComplete ? SIPStatus.VERIFIED : app.status,
        },
      });

      // Ledger entry — inside the transaction for atomicity
      await tx.ledgerEntry.create({
        data: {
          userId,
          direction: 'DEBIT',
          amount,
          balanceAfter: updatedUser.balance,
          sourceType: 'SIP_FOR_CHILD' as any,
          sourceId: applicationId,
        },
      });

      return { success: true, nextMonth: isComplete ? null : nextMonth, balanceAfter: updatedUser.balance };
    });
  }

  /**
   * Mark a month as missed and check if auto-rejection is needed.
   * Only marks a miss if the expected month hasn't already been paid.
   */
  async markMonthMissed(
    applicationId: string,
  ): Promise<{ rejected: boolean; monthsMissed: number; skipped: boolean }> {
    let auditData: {
      applicationId: string;
      userId: string;
      scheme: any;
      monthsMissed: number;
      refund: string;
    } | null = null;

    const result = await this.prisma.$transaction(async (tx) => {
      const app = await tx.sIPForChildApplication.findUnique({
        where: { id: applicationId },
        include: {
          premiums: {
            where: { status: 'PAID' },
            select: { monthNumber: true },
          },
        },
      });

      if (!app || app.status !== SIPStatus.VERIFIED) {
        return { rejected: false, monthsMissed: 0, skipped: true };
      }

      // Check if the expected month was already paid (scheduler/payment race guard)
      const expectedMonth = app.monthsPaid + 1;
      const alreadyPaid = app.premiums.some((p) => p.monthNumber === expectedMonth);
      if (alreadyPaid) {
        return { rejected: false, monthsMissed: 0, skipped: true };
      }

      // Use atomic increment to prevent lost-update race
      const newApp = await tx.sIPForChildApplication.update({
        where: { id: applicationId },
        data: {
          monthsMissed: { increment: 1 },
          nextPaymentDue: this.getNextDueDate(app.nextPaymentDue || new Date()),
        },
        select: { monthsMissed: true },
      });

      const newMissed = newApp.monthsMissed;
      const shouldReject = newMissed >= 4;

      if (shouldReject) {
        const paidPremiums = await tx.sIPForChildPremium.findMany({
          where: { applicationId, status: 'PAID' },
        });

        let totalRefund = new Prisma.Decimal(0);
        for (const premium of paidPremiums) {
          totalRefund = totalRefund.add(premium.amount);
          await tx.sIPForChildPremium.update({
            where: { id: premium.id },
            data: { status: 'REFUNDED' },
          });
        }

        if (totalRefund.greaterThan(0)) {
          const user = await tx.user.update({
            where: { id: app.userId },
            data: { balance: { increment: totalRefund } },
            select: { balance: true },
          });

          await tx.ledgerEntry.create({
            data: {
              userId: app.userId,
              direction: 'CREDIT',
              amount: totalRefund,
              balanceAfter: user.balance,
              sourceType: 'SIP_FOR_CHILD_REFUND' as any,
              sourceId: applicationId,
            },
          });
        }

        await tx.sIPForChildApplication.update({
          where: { id: applicationId },
          data: {
            status: SIPStatus.REJECTED,
            reviewNote: 'Auto-rejected: 4 consecutive missed premium payments',
            reviewedAt: new Date(),
          },
        });

        auditData = {
          applicationId,
          userId: app.userId,
          scheme: app.scheme,
          monthsMissed: newMissed,
          refund: totalRefund.toString(),
        };

        return { rejected: true, monthsMissed: newMissed, skipped: false };
      }

      return { rejected: false, monthsMissed: newMissed, skipped: false };
    });

    if (auditData !== null) {
      await this.audit.log({
        action: 'SIP_FOR_CHILD_AUTO_REJECTED' as any,
        metadata: auditData,
      });
    }

    return result;
  }

  /**
   * Find all premiums for an application.
   */
  async findPremiumsForApplication(applicationId: string) {
    return this.prisma.sIPForChildPremium.findMany({
      where: { applicationId },
      orderBy: { monthNumber: 'asc' },
    });
  }

  /**
   * Find premiums for a user.
   */
  async premiumsForUser(userId: string) {
    return this.prisma.sIPForChildPremium.findMany({
      where: { userId },
      include: {
        application: { select: { scheme: true, amount: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get premium summary for an application.
   */
  async getPremiumSummary(applicationId: string) {
    const premiums = await this.prisma.sIPForChildPremium.groupBy({
      by: ['status'],
      where: { applicationId },
      _sum: { amount: true },
      _count: true,
    });

    return premiums;
  }

  /**
   * Find applications that may have missed payments (VERIFIED, nextPaymentDue past now).
   */
  async findApplicationsWithDuePremiums() {
    return this.prisma.sIPForChildApplication.findMany({
      where: {
        status: SIPStatus.VERIFIED,
        nextPaymentDue: { not: null, lt: new Date() },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
          },
        },
      },
    });
  }

  private getNextDueDate(from: Date): Date {
    const d = new Date(from);
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    return d;
  }
}
