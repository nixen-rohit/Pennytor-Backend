import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  DepositRequest,
  DepositStatus,
  LedgerDirection,
  LedgerSourceType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class DepositRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  create(
    userId: string,
    data: Prisma.DepositRequestUncheckedCreateWithoutUserInput,
  ): Promise<DepositRequest> {
    return this.prisma.depositRequest.create({
      data: { ...data, userId },
    });
  }

  findById(id: string): Promise<Prisma.DepositRequestGetPayload<{
    include: {
      user: {
        select: {
          firstName: true;
          lastName: true;
          email: true;
          clientId: true;
          balance: true;
        };
      };
    };
  }> | null> {
    return this.prisma.depositRequest.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            clientId: true,
            balance: true,
          },
        },
      },
    });
  }

  findByIdPlain(id: string): Promise<DepositRequest | null> {
    return this.prisma.depositRequest.findUnique({ where: { id } });
  }

  listMine(userId: string): Promise<DepositRequest[]> {
    return this.prisma.depositRequest.findMany({
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

  async list(params: {
    status?: DepositStatus;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{
    items: Prisma.DepositRequestGetPayload<{
      include: { user: { select: { firstName: true; lastName: true; email: true; clientId: true } } };
    }>[];
    total: number;
  }> {
    const where: Prisma.DepositRequestWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.search
        ? {
            OR: [
              { user: { email: { contains: params.search, mode: 'insensitive' } } },
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
      this.prisma.depositRequest.findMany({
        where,
        include: {
          user: {
            select: { firstName: true, lastName: true, email: true, clientId: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.depositRequest.count({ where }),
    ]);

    return { items, total };
  }

  async setStatus(
    id: string,
    status: DepositStatus,
    reviewedBy: string,
    note?: string | null,
  ): Promise<DepositRequest> {
    return this.prisma.depositRequest.update({
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
   * Marks the request VERIFIED and credits the user's wallet in a single
   * transaction, so approval can never credit without the status flip.
   */
  async approveAndCredit(
    id: string,
    userId: string,
    reviewedBy: string,
    amount: Prisma.Decimal,
  ): Promise<DepositRequest> {
    const [updated] = await this.prisma.$transaction([
      this.prisma.depositRequest.update({
        where: { id },
        data: {
          status: DepositStatus.VERIFIED,
          reviewedBy,
          reviewedAt: new Date(),
          reviewNote: null,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { balance: { increment: amount } },
      }),
    ]);
    return updated;
  }

  /**
   * Production approve path: CONDITIONAL status flip (only a PENDING /
   * UNDER_REVIEW row matches), wallet credit, ledger entry and audit log in
   * one transaction. Two concurrent approvals cannot both match — the second
   * update matches zero rows and the whole operation rolls back.
   */
  async approve(row: DepositRequest, adminId: string): Promise<{ conflicted: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.depositRequest.updateMany({
        where: {
          id: row.id,
          status: { in: [DepositStatus.PENDING, DepositStatus.UNDER_REVIEW] },
        },
        data: {
          status: DepositStatus.VERIFIED,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          reviewNote: null,
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
          sourceType: LedgerSourceType.DEPOSIT,
          sourceId: row.id,
        },
      });
      await this.audit.log(
        {
          userId: adminId,
          action: AuditAction.APPROVE_DEPOSIT,
          metadata: {
            targetUserId: row.userId,
            transactionId: row.id,
            amount: row.amount.toString(),
            previousStatus: row.status,
            newStatus: DepositStatus.VERIFIED,
          },
        },
        tx,
      );
      return { conflicted: false };
    });
  }

  /**
   * Production reject path: conditional flip to REJECTED with the reason.
   * No money moves, so no ledger entry — only the audit record.
   */
  async reject(
    row: DepositRequest,
    adminId: string,
    reason: string,
  ): Promise<{ conflicted: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.depositRequest.updateMany({
        where: {
          id: row.id,
          status: { in: [DepositStatus.PENDING, DepositStatus.UNDER_REVIEW] },
        },
        data: {
          status: DepositStatus.REJECTED,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          reviewNote: reason,
        },
      });
      if (count !== 1) return { conflicted: true };
      await this.audit.log(
        {
          userId: adminId,
          action: AuditAction.REJECT_DEPOSIT,
          metadata: {
            targetUserId: row.userId,
            transactionId: row.id,
            amount: row.amount.toString(),
            previousStatus: row.status,
            newStatus: DepositStatus.REJECTED,
            reason,
          },
        },
        tx,
      );
      return { conflicted: false };
    });
  }
}