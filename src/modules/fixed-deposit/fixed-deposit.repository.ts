import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma, FixedDepositPlanId, FixedDepositStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface FDScheme {
  id: FixedDepositPlanId;
  name: string;
  depositAmount: number;
  lockInMonths: number;
  payoutMode: string;
  emiAmount: number;
  totalEmis: number;
  totalPayout: number;
}

const FD_SCHEMES: FDScheme[] = [
  {
    id: 'FD_25000',
    name: 'FD Plan 1',
    depositAmount: 25000,
    lockInMonths: 48,
    payoutMode: 'quarterly',
    emiAmount: 3130,
    totalEmis: 16,
    totalPayout: 50080,
  },
  {
    id: 'FD_50000',
    name: 'FD Plan 2',
    depositAmount: 50000,
    lockInMonths: 42,
    payoutMode: 'quarterly',
    emiAmount: 7145,
    totalEmis: 14,
    totalPayout: 100030,
  },
  {
    id: 'FD_100000',
    name: 'FD Plan 3',
    depositAmount: 100000,
    lockInMonths: 40,
    payoutMode: 'monthly',
    emiAmount: 5000,
    totalEmis: 40,
    totalPayout: 200000,
  },
];

@Injectable()
export class FixedDepositRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  getSchemes(): FDScheme[] {
    return FD_SCHEMES;
  }

  getSchemeById(id: FixedDepositPlanId): FDScheme | undefined {
    return FD_SCHEMES.find((s) => s.id === id);
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

  async create(
    userId: string,
    planId: FixedDepositPlanId,
  ) {
    const scheme = this.getSchemeById(planId);
    if (!scheme) throw new BadRequestException('Invalid plan');

    return this.prisma.fixedDepositApplication.create({
      data: {
        userId,
        planId,
        depositAmount: new Prisma.Decimal(scheme.depositAmount),
        lockInMonths: scheme.lockInMonths,
        payoutMode: scheme.payoutMode,
        emiAmount: new Prisma.Decimal(scheme.emiAmount),
        totalEmis: scheme.totalEmis,
        totalPayout: new Prisma.Decimal(scheme.totalPayout),
        status: 'PENDING',
        submittedAt: new Date(),
      },
    });
  }

  async findActiveByUser(userId: string, planId?: FixedDepositPlanId) {
    return this.prisma.fixedDepositApplication.findFirst({
      where: {
        userId,
        ...(planId ? { planId } : {}),
        status: { in: ['PENDING', 'VERIFIED'] },
      },
    });
  }

  async listMine(userId: string) {
    return this.prisma.fixedDepositApplication.findMany({
      where: { userId },
      include: { payouts: { orderBy: { emiNumber: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    return this.prisma.fixedDepositApplication.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, clientId: true } },
        payouts: { orderBy: { emiNumber: 'asc' } },
      },
    });
  }

  async list(query: {
    userId?: string;
    status?: FixedDepositStatus;
    search?: string;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.FixedDepositApplicationWhereInput = {};
    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { user: { email: { contains: query.search, mode: 'insensitive' } } },
        { user: { firstName: { contains: query.search, mode: 'insensitive' } } },
        { user: { lastName: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.fixedDepositApplication.findMany({
        where,
        include: {
          user: { select: { email: true, firstName: true, lastName: true, clientId: true } },
          payouts: { orderBy: { emiNumber: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.fixedDepositApplication.count({ where }),
    ]);

    return { items, total };
  }

  async approveAndStartCycle(id: string, adminId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const app = await tx.fixedDepositApplication.findUnique({ where: { id } });
      if (!app || app.status !== 'PENDING') {
        return { conflicted: true, application: null };
      }

      const now = new Date();
      const nextPayout = this.calculateNextPayout(now, app.payoutMode);

      const updated = await tx.fixedDepositApplication.update({
        where: { id },
        data: {
          status: 'VERIFIED',
          reviewedBy: adminId,
          reviewedAt: now,
          verifiedAt: now,
          nextPayoutAt: nextPayout,
        },
      });

      // Create all payout rows (PENDING)
      const payoutRows = [];
      for (let i = 1; i <= app.totalEmis; i++) {
        payoutRows.push({
          applicationId: id,
          userId: app.userId,
          emiNumber: i,
          amount: app.emiAmount,
          status: 'PENDING' as const,
        });
      }
      await tx.fixedDepositPayout.createMany({ data: payoutRows });

      // Debit deposit from wallet
      const user = await tx.user.update({
        where: { id: app.userId },
        data: { balance: { decrement: app.depositAmount } },
        select: { balance: true },
      });

      // Ledger entry
      await tx.ledgerEntry.create({
        data: {
          userId: app.userId,
          direction: 'DEBIT',
          amount: app.depositAmount,
          balanceAfter: user.balance,
          sourceType: 'FD_DEPOSIT' as any,
          sourceId: id,
        },
      });

      return { conflicted: false, application: updated };
    });

    return result;
  }

  async rejectAndRefund(id: string, adminId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const app = await tx.fixedDepositApplication.findUnique({ where: { id } });
      if (!app || app.status !== 'PENDING') {
        return { conflicted: true };
      }

      await tx.fixedDepositApplication.update({
        where: { id },
        data: {
          status: 'REJECTED',
          reviewedBy: adminId,
          reviewedAt: new Date(),
          reviewNote: reason,
        },
      });

      return { conflicted: false };
    });
  }

  async findDuePayouts() {
    return this.prisma.fixedDepositApplication.findMany({
      where: {
        status: 'VERIFIED',
        nextPayoutAt: { not: null, lt: new Date() },
      },
      include: {
        user: { select: { id: true, email: true, firstName: true } },
        payouts: { where: { status: 'PENDING' }, orderBy: { emiNumber: 'asc' }, take: 1 },
      },
    });
  }

  async creditPayout(applicationId: string, emiNumber: number) {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.fixedDepositPayout.findUnique({
        where: { applicationId_emiNumber: { applicationId, emiNumber } },
      });
      if (!payout || payout.status !== 'PENDING') return null;

      // Credit EMI to wallet
      const user = await tx.user.update({
        where: { id: payout.userId },
        data: { balance: { increment: payout.amount } },
        select: { balance: true },
      });

      // Mark payout as paid
      await tx.fixedDepositPayout.update({
        where: { id: payout.id },
        data: { status: 'PAID', paidAt: new Date() },
      });

      // Ledger entry
      await tx.ledgerEntry.create({
        data: {
          userId: payout.userId,
          direction: 'CREDIT',
          amount: payout.amount,
          balanceAfter: user.balance,
          sourceType: 'FD_PAYOUT' as any,
          sourceId: applicationId,
        },
      });

      // Update application counters
      const app = await tx.fixedDepositApplication.findUnique({ where: { id: applicationId } });
      if (!app) return null;

      const newEmisPaid = app.emisPaid + 1;
      const isComplete = newEmisPaid >= app.totalEmis;

      await tx.fixedDepositApplication.update({
        where: { id: applicationId },
        data: {
          emisPaid: newEmisPaid,
          lastPayoutAt: new Date(),
          nextPayoutAt: isComplete ? null : this.calculateNextPayout(new Date(), app.payoutMode),
          status: isComplete ? 'COMPLETED' : app.status,
        },
      });

      return { payout, balanceAfter: user.balance, isComplete };
    });
  }

  private calculateNextPayout(from: Date, payoutMode: string): Date {
    const d = new Date(from);
    d.setDate(1);
    if (payoutMode === 'quarterly') {
      d.setMonth(d.getMonth() + 3);
    } else {
      d.setMonth(d.getMonth() + 1);
    }
    return d;
  }
}
