import { Injectable } from '@nestjs/common';
import { DepositStatus } from '@prisma/client';
import { FinanceRepository, FinanceItem } from './finance.repository';
import { ListFinanceQueryDto } from './dto/list-finance-query.dto';

const APPROVED = 'APPROVED';
const REJECTED = 'REJECTED';
const PENDING = 'PENDING';

@Injectable()
export class FinanceService {
  constructor(private readonly repository: FinanceRepository) {}

  /** Merged deposit + withdrawal feed for the finance report (date order). */
  async listReports(query: ListFinanceQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.repository.listReports({
      type: query.type,
      status: query.status,
      search: query.search?.trim() || undefined,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      sortBy: query.sortBy ?? 'createdAt',
      sortOrder: query.sortOrder ?? 'desc',
      page,
      limit,
    });

    return {
      items: items.map((item) => this.toView(item)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /** Aggregated counters for the dashboard. */
  async summary() {
    return this.repository.summary();
  }

  private toView(item: FinanceItem) {
    return {
      id: item.id,
      type: item.type,
      status: item.status,
      displayStatus:
        item.status === DepositStatus.VERIFIED
          ? APPROVED
          : item.status === DepositStatus.REJECTED
            ? REJECTED
            : PENDING,
      amount: item.amount.toString(),
      transactionReference: item.transactionReference,
      method: item.method,
      destination: item.destination,
      submittedAt: item.submittedAt,
      reviewedAt: item.reviewedAt,
      reviewNote:
        item.status === DepositStatus.REJECTED ? item.reviewNote : null,
      createdAt: item.createdAt,
      applicant: item.user
        ? {
            firstName: item.user.firstName,
            lastName: item.user.lastName,
            email: item.user.email,
            clientId: item.user.clientId,
          }
        : null,
    };
  }
}