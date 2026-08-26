import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  LedgerDirection,
  LedgerSourceType,
  Prisma,
  WithdrawalRequest,
  WithdrawalStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

const USER_SELECT = {
  select: {
    firstName: true,
    lastName: true,
    email: true,
    clientId: true,
    balance: true,
  },
} as const;

export type WithdrawalWithUser = Prisma.WithdrawalRequestGetPayload<{
  include: { user: typeof USER_SELECT };
}>;

@Injectable()
export class WithdrawalRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  create(
    userId: string,
    data: Prisma.WithdrawalRequestUncheckedCreateWithoutUserInput,
  ): Promise<WithdrawalRequest> {
    return this.prisma.withdrawalRequest.create({
      data: { ...data, userId },
    });
  }

  /**
   * Atomic creation of withdrawal + wallet debit + ledger entry.
   * Returns the created withdrawal request.
   */
  async createWithDebit(
    userId: string,
    amount: Prisma.Decimal,
    method: string,
    destination: string,
    userBalance: Prisma.Decimal,
  ): Promise<WithdrawalRequest> {
    const [created] = await this.prisma.$transaction([
      this.prisma.withdrawalRequest.create({
        data: {
          userId,
          amount,
          method: method as any,
          destination,
          submittedAt: new Date(),
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { balance: { decrement: amount } },
      }),
      this.prisma.ledgerEntry.create({
        data: {
          userId,
          direction: LedgerDirection.DEBIT,
          amount,
          balanceAfter: userBalance.minus(amount),
          sourceType: LedgerSourceType.WITHDRAWAL,
          sourceId: 'pending',
        },
      }),
    ]);

    // Update ledger entry with actual withdrawal ID
    await this.prisma.ledgerEntry.updateMany({
      where: {
        userId,
        sourceId: 'pending',
        sourceType: LedgerSourceType.WITHDRAWAL,
      },
      data: { sourceId: created.id },
    });

    return created;
  }

  findById(id: string): Promise<WithdrawalWithUser | null> {
    return this.prisma.withdrawalRequest.findUnique({
      where: { id },
      include: { user: USER_SELECT },
    });
  }

  findByIdPlain(id: string): Promise<WithdrawalRequest | null> {
    return this.prisma.withdrawalRequest.findUnique({ where: { id } });
  }

  listMine(userId: string): Promise<WithdrawalRequest[]> {
    return this.prisma.withdrawalRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBalance(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    return (user?.balance ?? new Prisma.Decimal(0)).toString();
  }

  async getUserWithPasswordHash(userId: string): Promise<{
    id: string;
    passwordHash: string;
    balance: Prisma.Decimal;
    firstName: string;
    email: string;
  } | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        passwordHash: true,
        balance: true,
        firstName: true,
        email: true,
      },
    });
  }

  async list(params: {
    status?: WithdrawalStatus;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: WithdrawalWithUser[]; total: number }> {
    const where: Prisma.WithdrawalRequestWhereInput = {
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
      this.prisma.withdrawalRequest.findMany({
        where,
        include: { user: USER_SELECT },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.withdrawalRequest.count({ where }),
    ]);

    return { items, total };
  }

  async setStatus(
    id: string,
    status: WithdrawalStatus,
    reviewedBy: string,
    note?: string | null,
  ): Promise<WithdrawalRequest> {
    return this.prisma.withdrawalRequest.update({
      where: { id },
      data: {
        status,
        reviewedBy,
        reviewedAt: new Date(),
        ...(note !== undefined ? { reviewNote: note } : {}),
      },
    });
  }

  /**
   * Marks the request VERIFIED and debits the user's wallet in a single
   * transaction, so an approval can never debit without the status flip.
   */
  async approveAndDebit(
    id: string,
    userId: string,
    reviewedBy: string,
    amount: Prisma.Decimal,
  ): Promise<WithdrawalRequest> {
    const [updated] = await this.prisma.$transaction([
      this.prisma.withdrawalRequest.update({
        where: { id },
        data: {
          status: WithdrawalStatus.VERIFIED,
          reviewedBy,
          reviewedAt: new Date(),
          reviewNote: null,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { balance: { decrement: amount } },
      }),
    ]);
    return updated;
  }

  /** Production approve path: conditional flip to VERIFIED (no debit - already done at creation). */
  async approveStatusOnly(
    row: WithdrawalRequest,
    adminId: string,
  ): Promise<{ conflicted: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.withdrawalRequest.updateMany({
        where: {
          id: row.id,
          status: {
            in: [WithdrawalStatus.PENDING, WithdrawalStatus.UNDER_REVIEW],
          },
        },
        data: {
          status: WithdrawalStatus.VERIFIED,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          reviewNote: null,
        },
      });
      if (count !== 1) return { conflicted: true };
      await this.audit.log(
        {
          userId: adminId,
          action: AuditAction.APPROVE_WITHDRAWAL,
          metadata: {
            targetUserId: row.userId,
            transactionId: row.id,
            amount: row.amount.toString(),
            previousStatus: row.status,
            newStatus: WithdrawalStatus.VERIFIED,
          },
        },
        tx,
      );
      return { conflicted: false };
    });
  }

  /** Production reject path: conditional flip to REJECTED with the reason + audit + refund. */
  async reject(
    row: WithdrawalRequest,
    adminId: string,
    reason: string,
  ): Promise<{ conflicted: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.withdrawalRequest.updateMany({
        where: {
          id: row.id,
          status: {
            in: [WithdrawalStatus.PENDING, WithdrawalStatus.UNDER_REVIEW],
          },
        },
        data: {
          status: WithdrawalStatus.REJECTED,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          reviewNote: reason,
        },
      });
      if (count !== 1) return { conflicted: true };

      // Refund the wallet
      const user = await tx.user.update({
        where: { id: row.userId },
        data: { balance: { increment: row.amount } },
        select: { balance: true },
      });

      // Ledger entry for refund (CREDIT)
      await tx.ledgerEntry.create({
        data: {
          userId: row.userId,
          direction: LedgerDirection.CREDIT,
          amount: row.amount,
          balanceAfter: user.balance,
          sourceType: LedgerSourceType.WITHDRAWAL_REFUND,
          sourceId: row.id,
        },
      });

      await this.audit.log(
        {
          userId: adminId,
          action: AuditAction.REJECT_WITHDRAWAL,
          metadata: {
            targetUserId: row.userId,
            transactionId: row.id,
            amount: row.amount.toString(),
            previousStatus: row.status,
            newStatus: WithdrawalStatus.REJECTED,
            reason,
            refunded: true,
          },
        },
        tx,
      );
      return { conflicted: false };
    });
  }
}
