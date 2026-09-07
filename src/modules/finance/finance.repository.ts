import { Injectable } from '@nestjs/common';
import {
  DepositRequest,
  DepositStatus,
  Prisma,
  WithdrawalRequest,
  WithdrawalStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  FinanceType,
  FinanceSortBy,
  FinanceSortOrder,
  toOrderBy,
} from './dto/list-finance-query.dto';

const USER_SELECT = {
  select: {
    firstName: true,
    lastName: true,
    email: true,
    clientId: true,
  },
} as const;

export type FinanceItem = {
  id: string;
  type: FinanceType;
  amount: Prisma.Decimal;
  status: DepositStatus;
  createdAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  transactionReference: string | null;
  method: string | null;
  destination: string | null;
  user: {
    firstName: string;
    lastName: string;
    email: string;
    clientId: string | null;
  } | null;
};

@Injectable()
export class FinanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finance report: every deposit + withdrawal merged into one feed, sorted
   * by date/time. Filtering, pagination, sorting and searching all happen on
   * the backend. Each table is queried in sorted slices and the slices are
   * k-way merged, so the page slice, total and ordering are all computed
   * server-side — the browser never receives more than one page.
   */
  async listReports(params: {
    type?: FinanceType;
    status?: DepositStatus;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    sortBy: FinanceSortBy;
    sortOrder: FinanceSortOrder;
    page: number;
    limit: number;
  }): Promise<{ items: FinanceItem[]; total: number }> {
    const { page, limit } = params;
    const offset = (page - 1) * limit;

    const userSearch: Prisma.UserWhereInput | undefined = params.search
      ? {
          OR: [
            { email: { contains: params.search, mode: 'insensitive' } },
            { clientId: { contains: params.search, mode: 'insensitive' } },
          ],
        }
      : undefined;

    const timeFilter = {
      ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
      ...(params.dateTo
        ? { lt: new Date(new Date(params.dateTo).getTime() + 86_400_000) }
        : {}),
    };
    const dateWhere =
      timeFilter.gte || timeFilter.lt ? { createdAt: timeFilter } : {};

    const queryDeposits = params.type !== 'WITHDRAWAL';
    const queryWithdrawals = params.type !== 'DEPOSIT';

    const statusDep = params.status;
    const statusWdr = params.status as WithdrawalStatus | undefined;

    const [depTotal, wdrTotal] = await Promise.all([
      queryDeposits
        ? this.prisma.depositRequest.count({
            where: {
              ...dateWhere,
              ...(statusDep ? { status: statusDep } : {}),
              ...(userSearch ? { user: userSearch } : {}),
            },
          })
        : Promise.resolve(0),
      queryWithdrawals
        ? this.prisma.withdrawalRequest.count({
            where: {
              ...dateWhere,
              ...(statusWdr ? { status: statusWdr } : {}),
              ...(userSearch ? { user: userSearch } : {}),
            },
          })
        : Promise.resolve(0),
    ]);

    const total = depTotal + wdrTotal;
    if (total === 0) return { items: [], total };

    const orderBy: Prisma.DepositRequestOrderByWithRelationInput[] = toOrderBy(
      params.sortBy,
      params.sortOrder,
    );
    const cmp = this.comparator(params.sortBy, params.sortOrder);
    const need = offset + limit;

    let depSkip = 0;
    let wdrSkip = 0;
    let depDone = false;
    let wdrDone = false;
    let buffer: FinanceItem[] = [];

    type DepositWithUser = Prisma.DepositRequestGetPayload<{
      include: {
        user: {
          select: {
            firstName: true;
            lastName: true;
            email: true;
            clientId: true;
          };
        };
      };
    }>;
    type WithdrawalWithUser = Prisma.WithdrawalRequestGetPayload<{
      include: {
        user: {
          select: {
            firstName: true;
            lastName: true;
            email: true;
            clientId: true;
          };
        };
      };
    }>;

    while (buffer.length < need && !(depDone && wdrDone)) {
      const chunk = limit;
      const depRows: DepositWithUser[] = [];
      const wdrRows: WithdrawalWithUser[] = [];
      if (queryDeposits && !depDone) {
        depRows.push(
          ...(await this.prisma.depositRequest.findMany({
            where: {
              ...dateWhere,
              ...(statusDep ? { status: statusDep } : {}),
              ...(userSearch ? { user: userSearch } : {}),
            },
            include: { user: USER_SELECT },
            orderBy,
            skip: depSkip,
            take: chunk,
          })),
        );
      }
      if (queryWithdrawals && !wdrDone) {
        wdrRows.push(
          ...(await this.prisma.withdrawalRequest.findMany({
            where: {
              ...dateWhere,
              ...(statusWdr ? { status: statusWdr } : {}),
              ...(userSearch ? { user: userSearch } : {}),
            },
            include: { user: USER_SELECT },
            orderBy,
            skip: wdrSkip,
            take: chunk,
          })),
        );
      }

      depDone = !queryDeposits || depRows.length < chunk;
      wdrDone = !queryWithdrawals || wdrRows.length < chunk;
      depSkip += depRows.length;
      wdrSkip += wdrRows.length;

      const round = mergeSorted(
        depRows.map((r) => this.toItem(r, 'DEPOSIT')),
        wdrRows.map((r) => this.toItem(r, 'WITHDRAWAL')),
        cmp,
      );
      buffer = mergeSorted(buffer, round, cmp);
    }

    return { items: buffer.slice(offset, offset + limit), total };
  }

  private comparator(sortBy: FinanceSortBy, sortOrder: FinanceSortOrder) {
    const dir = sortOrder === 'asc' ? 1 : -1;
    return (a: FinanceItem, b: FinanceItem): number => {
      if (sortBy === 'amount') {
        const c = a.amount.cmp(b.amount) * dir;
        if (c !== 0) return c;
      } else if (sortBy === 'submittedAt') {
        const av = a.submittedAt;
        const bv = b.submittedAt;
        if (av && bv) {
          const c = (av.getTime() - bv.getTime()) * dir;
          if (c !== 0) return c;
        } else if (av === null && bv !== null) {
          // Postgres semantics: NULLS LAST on ASC, NULLS FIRST on DESC
          return sortOrder === 'asc' ? 1 : -1;
        } else if (bv === null && av !== null) {
          return sortOrder === 'asc' ? -1 : 1;
        }
      } else {
        const c = (a.createdAt.getTime() - b.createdAt.getTime()) * dir;
        if (c !== 0) return c;
      }
      return a.id < b.id ? -dir : a.id > b.id ? dir : 0;
    };
  }

  private toItem(
    row: DepositRequest | WithdrawalRequest,
    type: FinanceType,
  ): FinanceItem {
    const d = row as DepositRequest;
    const w = row as WithdrawalRequest;
    return {
      id: row.id,
      type,
      amount: row.amount,
      status: row.status as DepositStatus,
      createdAt: row.createdAt,
      submittedAt: row.submittedAt,
      reviewedAt: row.reviewedAt,
      reviewNote: row.reviewNote,
      transactionReference: type === 'DEPOSIT' ? d.transactionId : null,
      method: type === 'WITHDRAWAL' ? w.method : null,
      destination: type === 'WITHDRAWAL' ? w.destination : null,
      user: (row as DepositRequest & { user?: unknown }).user as
        FinanceItem['user'] | null,
    };
  }

  /**
   * Aggregated counters for the dashboard, computed with GROUP BY on the
   * database — no per-row data ever leaves the server.
   */
  async summary() {
    const [depGroups, wdrGroups] = await Promise.all([
      this.prisma.depositRequest.groupBy({
        by: ['status'],
        _count: true,
        _sum: { amount: true },
      }),
      this.prisma.withdrawalRequest.groupBy({
        by: ['status'],
        _count: true,
        _sum: { amount: true },
      }),
    ]);

    const countFor = (
      groups: { status: DepositStatus; _count: number }[],
      status: DepositStatus,
    ) => groups.find((g) => g.status === status)?._count ?? 0;

    const dep = {
      total: depGroups.reduce((n, g) => n + g._count, 0),
      pending: countFor(depGroups, DepositStatus.PENDING),
      underReview: countFor(depGroups, DepositStatus.UNDER_REVIEW),
      approved: countFor(depGroups, DepositStatus.VERIFIED),
      rejected: countFor(depGroups, DepositStatus.REJECTED),
      approvedAmount: (
        depGroups.find((g) => g.status === DepositStatus.VERIFIED)?._sum
          .amount ?? new Prisma.Decimal(0)
      ).toString(),
    };
    const wdr = {
      total: wdrGroups.reduce((n, g) => n + g._count, 0),
      pending: countFor(wdrGroups, WithdrawalStatus.PENDING),
      underReview: countFor(wdrGroups, WithdrawalStatus.UNDER_REVIEW),
      approved: countFor(wdrGroups, WithdrawalStatus.VERIFIED),
      rejected: countFor(wdrGroups, WithdrawalStatus.REJECTED),
      approvedAmount: (
        wdrGroups.find((g) => g.status === WithdrawalStatus.VERIFIED)?._sum
          .amount ?? new Prisma.Decimal(0)
      ).toString(),
    };

    return {
      deposits: dep,
      withdrawals: wdr,
      totals: {
        totalTransactions: dep.total + wdr.total,
        totalPending: dep.pending + wdr.pending,
        totalApproved: dep.approved + wdr.approved,
        totalRejected: dep.rejected + wdr.rejected,
      },
    };
  }
}

/** Merges two already-sorted arrays into one sorted array (stable). */
function mergeSorted<T>(a: T[], b: T[], cmp: (x: T, y: T) => number): T[] {
  const out: T[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (cmp(a[i], b[j]) <= 0) out.push(a[i++]);
    else out.push(b[j++]);
  }
  while (i < a.length) out.push(a[i++]);
  while (j < b.length) out.push(b[j++]);
  return out;
}
