import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  InvestmentApplication,
  InvestmentScheme,
  InvestmentStatus,
  LedgerDirection,
  LedgerSourceType,
  Prisma,
} from '@prisma/client';
import { OtpService } from '../otp/otp.service';
import { OtpPurpose } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { verifyPassword } from '../../common/utils/password.util';
import {
  InvestmentFundRepository,
  addMonths,
  wholeMonthsBetween,
} from './investment-fund.repository';
import { PrismaService } from '../../database/prisma.service';
import { CreateInvestmentApplicationDto } from './dto/investment-fund.dto';

/** Every scheme carries a fixed 3-year lock-in. */
const LOCK_IN_MONTHS = 36;

/** Max wrong-password verifications per user per calendar day. */
const MAX_DAILY_FAILED_VERIFICATIONS = 5;

/** ₹1,50,000.00 style Indian formatting for email copies. */
function inr(value: Prisma.Decimal | string): string {
  const n = typeof value === 'string' ? new Prisma.Decimal(value) : value;
  return `₹${n.toNumber().toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** 24 Aug 2026 — timezone-free label for email copies. */
function formatDate(d: Date): string {
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

@Injectable()
export class InvestmentFundService {
  private readonly logger = new Logger(InvestmentFundService.name);
  /** userId -> { day: 'YYYY-MM-DD', count } — resets each calendar day. */
  private readonly failedVerifications = new Map<
    string,
    { day: string; count: number }
  >();

  constructor(
    private readonly repository: InvestmentFundRepository,
    private readonly otpService: OtpService,
    private readonly mailService: MailService,
    private readonly prisma: PrismaService,
  ) {}

  async getSchemes() {
    return [
      {
        id: 1,
        scheme: InvestmentScheme.A,
        minAmount: 500000,
        maxAmount: 2500000,
        lockInPeriod: '3 Years',
        roi: 3,
      },
      {
        id: 2,
        scheme: InvestmentScheme.B,
        minAmount: 2500000,
        maxAmount: 5000000,
        lockInPeriod: '3 Years',
        roi: 3.5,
      },
      {
        id: 3,
        scheme: InvestmentScheme.C,
        minAmount: 5000000,
        maxAmount: 10000000,
        lockInPeriod: '3 Years',
        roi: 4,
      },
      {
        id: 4,
        scheme: InvestmentScheme.D,
        minAmount: 10000000,
        maxAmount: 50000000,
        lockInPeriod: '3 Years',
        roi: 4.5,
      },
      {
        id: 5,
        scheme: InvestmentScheme.E,
        minAmount: 50000000,
        maxAmount: 999999999,
        lockInPeriod: '3 Years',
        roi: 5,
      },
    ];
  }

  async sendOtp(
    userId: string,
    scheme?: string,
    investmentAmount?: string,
    lockInPeriod?: string,
    roi?: number,
  ) {
    const user = await this.repository.getUserWithPasswordHash(userId);
    if (!user?.email) throw new NotFoundException('User account not found');

    const plainOtp = await this.otpService.generate(
      userId,
      OtpPurpose.WITHDRAW_SUBMIT,
    );

    const templateParams: any = {
      to: user.email,
      firstName: user.firstName,
      otp: plainOtp,
    };

    if (scheme) {
      const schemeData = (await this.getSchemes()).find(
        (s) => s.scheme === scheme,
      );

      // The user's actual applied amount (falls back to the scheme max when
      // the caller could not supply it) plus the fixed scheme range.
      const userAmount = investmentAmount
        ? Number(investmentAmount).toLocaleString('en-IN')
        : schemeData
          ? schemeData.maxAmount.toLocaleString('en-IN')
          : 'N/A';
      const schemeRange = schemeData
        ? `₹${schemeData.minAmount.toLocaleString('en-IN')} – ₹${schemeData.maxAmount.toLocaleString('en-IN')}`
        : 'N/A';

      templateParams.scheme = `Investment Fund (Scheme ${scheme})`;
      templateParams.investmentAmount = userAmount;
      templateParams.schemeRange = schemeRange;
      templateParams.lockInPeriod = lockInPeriod || '3 Years';
      templateParams.roi = roi || schemeData?.roi || 0;
      await this.mailService.sendInvestmentFundOtpEmail(templateParams);
    } else {
      await this.mailService.sendWithdrawalOtpEmail({
        to: user.email,
        firstName: user.firstName,
        otp: plainOtp,
      });
    }
  }

  async verifyPasswordAndSendOtp(
    userId: string,
    password: string,
    scheme: string,
    amount?: string,
  ) {
    this.assertAttemptsAvailable(userId);

    const user = await this.repository.getUserWithPasswordHash(userId);
    if (!user) throw new NotFoundException('User account not found');

    const { valid } = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      const remaining = this.registerFailure(userId);
      throw new BadRequestException(
        `Password is incorrect. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining today.`,
      );
    }

    this.failedVerifications.delete(userId);
    await this.sendOtp(userId, scheme, amount);
    return { success: true };
  }

  private assertAttemptsAvailable(userId: string) {
    const rec = this.failedVerifications.get(userId);
    if (
      rec &&
      rec.day === new Date().toISOString().slice(0, 10) &&
      rec.count >= MAX_DAILY_FAILED_VERIFICATIONS
    ) {
      throw new HttpException(
        'Too many incorrect password attempts today. Please try again tomorrow or reset your password.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Records a failed verification and returns attempts left today. */
  private registerFailure(userId: string): number {
    const day = new Date().toISOString().slice(0, 10);
    const rec = this.failedVerifications.get(userId);
    const next = rec && rec.day === day ? rec.count + 1 : 1;
    this.failedVerifications.set(userId, { day, count: next });
    return Math.max(0, MAX_DAILY_FAILED_VERIFICATIONS - next);
  }

  async createApplication(userId: string, dto: CreateInvestmentApplicationDto) {
    const user = await this.repository.getUserWithPasswordHash(userId);
    if (!user) throw new NotFoundException('User account not found');

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('Investment amount must be greater than 0');
    }

    const scheme = (await this.getSchemes()).find(
      (s) => s.scheme === dto.scheme,
    );
    if (!scheme) {
      throw new BadRequestException('Invalid scheme');
    }

    if (amount.lt(scheme.minAmount)) {
      throw new BadRequestException(
        `Minimum investment is ${scheme.minAmount.toLocaleString('en-IN')}`,
      );
    }
    if (amount.gt(scheme.maxAmount)) {
      throw new BadRequestException(
        `Maximum investment is ${scheme.maxAmount.toLocaleString('en-IN')}`,
      );
    }

    if (amount.gt(user.balance)) {
      throw new BadRequestException(
        'Insufficient wallet balance for this investment',
      );
    }

    const { valid } = await verifyPassword(dto.password, user.passwordHash);
    if (!valid) {
      throw new BadRequestException('Password is incorrect');
    }

    await this.otpService.verify(userId, OtpPurpose.WITHDRAW_SUBMIT, dto.otp);

    // Check if user already has an active application for this scheme
    const existingApplication = await this.repository.findActiveByUserAndScheme(
      userId,
      dto.scheme,
    );
    if (existingApplication) {
      const schemeData = (await this.getSchemes()).find(
        (s) => s.scheme === dto.scheme,
      );
      const lockInYears = schemeData?.lockInPeriod || '3 Years';
      throw new BadRequestException(
        `You already have an active ${dto.scheme} scheme application. You are eligible again after ${lockInYears} when the current scheme completes.`,
      );
    }

    const created = await this.repository.create(userId, {
      scheme: dto.scheme,
      amount,
      method: 'investment-fund',
      destination: `Scheme ${dto.scheme}`,
      submittedAt: new Date(),
    });

    // Debit wallet
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { balance: { decrement: amount } },
      }),
      this.prisma.ledgerEntry.create({
        data: {
          userId,
          direction: LedgerDirection.DEBIT,
          amount,
          balanceAfter: user.balance.minus(amount),
          sourceType: LedgerSourceType.WITHDRAWAL,
          sourceId: created.id,
        },
      }),
    ]);

    return {
      id: created.id,
      status: created.status,
      amount: created.amount.toString(),
    };
  }

  /**
   * User dashboard feed — "User Investments". Includes the fixed scheme
   * economics (monthly return, lock-in) and the live cycle state: months
   * elapsed/remaining and when the next monthly ROI lands.
   */
  async myApplications(userId: string) {
    const rows = await this.repository.listMine(userId);
    const schemes = await this.getSchemes();
    const roiTotals = await this.repository.roiTotalsForUser(userId);
    const now = new Date();

    const items = [];
    for (const r of rows) {
      const scheme = schemes.find((s) => s.scheme === r.scheme)!;
      const monthlyRoi = r.amount
        .mul(scheme.roi)
        .div(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);

      const base = {
        id: r.id,
        scheme: r.scheme,
        planLabel: `Plan ${r.scheme}`,
        amount: r.amount.toString(),
        roiPercent: scheme.roi,
        monthlyRoi: monthlyRoi.toString(),
        lockInMonths: LOCK_IN_MONTHS,
        status: r.status,
        // Money left the wallet at apply time; only a rejection returns it.
        debited: true,
        refunded: r.status === InvestmentStatus.REJECTED,
        reviewNote:
          r.status === InvestmentStatus.REJECTED ? r.reviewNote : null,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        totalRoiPaid: (roiTotals[r.id] ?? new Prisma.Decimal(0)).toString(),
        cycle: null as null | {
          startAt: string;
          lockEndsAt: string;
          nextPayoutAt: string | null;
          lastRoiPaidAt: string;
          monthsElapsed: number;
          monthsRemaining: number;
        },
      };

      if (
        r.status === InvestmentStatus.VERIFIED &&
        r.verifiedAt &&
        r.lastRoiPaidAt
      ) {
        const lockEnd = addMonths(r.verifiedAt, LOCK_IN_MONTHS);
        const nextRaw = addMonths(r.lastRoiPaidAt, 1);
        const monthsElapsed = Math.min(
          wholeMonthsBetween(r.verifiedAt, now),
          LOCK_IN_MONTHS,
        );
        base.cycle = {
          startAt: r.verifiedAt.toISOString(),
          lockEndsAt: lockEnd.toISOString(),
          // Payouts land on the same date every month — the anniversary of
          // the approval — until the lock-in ends.
          nextPayoutAt: nextRaw <= lockEnd ? nextRaw.toISOString() : null,
          lastRoiPaidAt: r.lastRoiPaidAt.toISOString(),
          monthsElapsed,
          monthsRemaining: Math.max(0, LOCK_IN_MONTHS - monthsElapsed),
        };
      }

      items.push(base);
    }

    return { items };
  }

  /**
   * User transaction report for investment funds. One merged, newest-first
   * feed: the original debit into a scheme, the refund if rejected, and
   * every monthly ROI credit with its scheme and exact date-time.
   */
  async myReports(userId: string) {
    const [rows, payouts] = await Promise.all([
      this.repository.listMine(userId),
      this.repository.payoutHistory(userId),
    ]);

    type Entry = {
      id: string;
      kind: 'INVESTMENT' | 'REFUND' | 'ROI';
      planLabel: string;
      direction: 'DEBIT' | 'CREDIT';
      amount: string;
      status: InvestmentStatus | null;
      occurredAt: string;
    };

    const entries: Entry[] = [];

    for (const r of rows) {
      entries.push({
        id: `inv-${r.id}`,
        kind: 'INVESTMENT',
        planLabel: `Investment Fund Scheme(${r.scheme})`,
        direction: 'DEBIT',
        amount: r.amount.toString(),
        status: r.status,
        occurredAt: (r.submittedAt ?? r.createdAt).toISOString(),
      });
      if (r.status === InvestmentStatus.REJECTED && r.reviewedAt) {
        entries.push({
          id: `ref-${r.id}`,
          kind: 'REFUND',
          planLabel: `Investment Fund Scheme(${r.scheme})`,
          direction: 'CREDIT',
          amount: r.amount.toString(),
          status: null,
          occurredAt: r.reviewedAt.toISOString(),
        });
      }
    }

    for (const p of payouts) {
      entries.push({
        id: `roi-${p.id}`,
        kind: 'ROI',
        planLabel: `Investment Fund Scheme(${p.application.scheme})`,
        direction: 'CREDIT',
        amount: p.amount.toString(),
        status: null,
        occurredAt: p.createdAt.toISOString(),
      });
    }

    entries.sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );

    return { items: entries };
  }

  // ---------------------------------------------------------------- admin

  /** Admin list feed — shape matches the admin dashboard table exactly. */
  async adminList(query: {
    status?: InvestmentStatus;
    search?: string;
    page: number;
    pageSize: number;
  }) {
    const { items, total } = await this.repository.list({
      status: query.status,
      search: query.search?.trim() || undefined,
      page: query.page,
      pageSize: query.pageSize,
    });

    return {
      items: items.map((r) => ({
        id: r.id,
        applicantEmail: r.user.email,
        applicantName: [r.user.firstName, r.user.lastName]
          .filter(Boolean)
          .join(' '),
        scheme: `Plan ${r.scheme}`,
        amount: r.amount.toString(),
        kycStatus: this.toFrontendKyc(r.user.kycApplication?.status ?? null),
        status: r.status,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
    };
  }

  /** Admin detail — fixed scheme info + live ROI cycle state for review. */
  async adminDetail(id: string) {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException('Investment application not found');

    const schemeInfo = (await this.getSchemes()).find(
      (s) => s.scheme === row.scheme,
    )!;
    const totalRoiPaid = await this.repository.totalRoiPaid(row.id);

    const cycle = this.computeCycleState(row, schemeInfo.roi);

    return {
      id: row.id,
      scheme: row.scheme,
      amount: row.amount.toString(),
      status: row.status,
      reviewNote: row.reviewNote,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      user: {
        firstName: row.user.firstName,
        lastName: row.user.lastName,
        email: row.user.email,
        clientId: row.user.clientId,
      },
      kycStatus: this.toFrontendKyc(row.user.kycApplication?.status ?? null),
      schemeInfo: {
        label: `Plan ${row.scheme}`,
        roiPercent: schemeInfo.roi,
        lockInMonths: LOCK_IN_MONTHS,
        minAmount: String(schemeInfo.minAmount),
        maxAmount: String(schemeInfo.maxAmount),
      },
      totalRoiPaid: totalRoiPaid.toString(),
      cycle,
    };
  }

  /**
   * Approve a PENDING/UNDER_REVIEW application and start its ROI cycle.
   * Race-safe: only the first transition wins, later ones get 409.
   */
  async approve(id: string, adminId: string) {
    // Full row with user so the approval email has the review copy target.
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException('Investment application not found');

    const { conflicted, application } =
      await this.repository.approveAndStartCycle(row, adminId);
    if (conflicted || !application) {
      throw new ConflictException(
        'Application already processed; only pending applications can be approved',
      );
    }

    // Pass the POST-approval row — it carries the verifiedAt that was null
    // on the pre-approval snapshot.
    await this.sendApprovalEmail(application);
    return { id, status: InvestmentStatus.VERIFIED };
  }

  /**
   * Email copy of the approved review data — plan, amount, monthly ROI and
   * the payout calendar. Best-effort: an SMTP failure must never fail the
   * approval itself (the transaction has already committed).
   */
  private async sendApprovalEmail(
    row: Prisma.InvestmentApplicationGetPayload<{
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
    }>,
  ) {
    if (!row.verifiedAt || !row.user?.email) return;
    try {
      const scheme = (await this.getSchemes()).find(
        (s) => s.scheme === row.scheme,
      )!;
      const monthlyRoi = row.amount
        .mul(scheme.roi)
        .div(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
      const lockEnd = addMonths(row.verifiedAt, LOCK_IN_MONTHS);

      await this.mailService.sendInvestmentFundApprovedEmail({
        to: row.user.email,
        firstName: row.user.firstName,
        planName: `Investment Fund (Scheme ${row.scheme})`,
        amount: inr(row.amount),
        monthlyRoi: inr(monthlyRoi),
        roiPercent: `${scheme.roi}%`,
        lockInPeriod: scheme.lockInPeriod,
        cycleStartDate: formatDate(row.verifiedAt),
        nextPayoutDate: formatDate(addMonths(row.verifiedAt, 1)),
        maturityDate: formatDate(lockEnd),
      });
    } catch (error) {
      this.logger.error(
        `Approval email failed for application ${row.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Reject a PENDING/UNDER_REVIEW application with a reason (min 3 chars).
   * The submission debit is refunded to the wallet atomically.
   */
  async reject(id: string, adminId: string, reason: string) {
    const clean = reason.trim();
    if (clean.length < 3) {
      throw new BadRequestException(
        'A rejection reason of at least 3 characters is required',
      );
    }
    const row = await this.repository.findByIdPlain(id);
    if (!row) throw new NotFoundException('Investment application not found');

    const { conflicted } = await this.repository.rejectAndRefund(
      row,
      adminId,
      clean,
    );
    if (conflicted) {
      throw new ConflictException(
        'Application already processed; only pending applications can be rejected',
      );
    }
    return { id, status: InvestmentStatus.REJECTED };
  }

  // ------------------------------------------------------------- auto ROI

  /**
   * Auto-ROI engine. For every VERIFIED application it walks forward from
   * lastRoiPaidAt in whole calendar months, credits amount * roi% per month
   * (never past the 3-year lock-in end), then advances lastRoiPaidAt.
   * Idempotent: an already-credited month is never paid twice because
   * lastRoiPaidAt only advances inside the same transaction as the credit.
   */
  async processRoiPayouts(now = new Date()): Promise<{
    applicationsProcessed: number;
    monthsCredited: number;
  }> {
    const schemes = await this.getSchemes();
    const rows = await this.repository.findDueForRoi();

    let applicationsProcessed = 0;
    let monthsCredited = 0;

    for (const row of rows) {
      try {
        const periods = this.dueRoiPeriods(row, now);
        if (periods.length === 0) continue;

        const scheme = schemes.find((s) => s.scheme === row.scheme)!;
        const credited = await this.repository.payRoi(row, periods, scheme.roi);
        if (credited > 0) {
          applicationsProcessed += 1;
          monthsCredited += credited;
        }
      } catch (error) {
        // One bad application must not block the rest of the batch.
        this.logger.error(
          `ROI payout failed for application ${row.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    if (monthsCredited > 0) {
      this.logger.log(
        `ROI run credited ${monthsCredited} month(s) across ${applicationsProcessed} application(s)`,
      );
    }
    return { applicationsProcessed, monthsCredited };
  }

  /**
   * Whole monthly periods between lastRoiPaidAt and min(now, lock-in end).
   * A month counts once fully elapsed on the calendar (same day-of-month).
   */
  private dueRoiPeriods(
    row: InvestmentApplication,
    now: Date,
  ): Array<{ start: Date; end: Date }> {
    if (!row.verifiedAt || !row.lastRoiPaidAt) return [];

    const lockEnd = addMonths(row.verifiedAt, LOCK_IN_MONTHS);
    const horizon = now < lockEnd ? now : lockEnd;

    const totalElapsed = wholeMonthsBetween(row.lastRoiPaidAt, horizon);
    if (totalElapsed <= 0) return [];

    const periods: Array<{ start: Date; end: Date }> = [];
    let cursor = row.lastRoiPaidAt;
    for (let i = 0; i < totalElapsed; i += 1) {
      const end = addMonths(cursor, 1);
      if (end > lockEnd) break;
      periods.push({ start: cursor, end });
      cursor = end;
    }
    return periods;
  }

  /** Live cycle snapshot for the admin review screen. */
  private computeCycleState(row: InvestmentApplication, roiPercent: number) {
    if (
      row.status !== InvestmentStatus.VERIFIED ||
      !row.verifiedAt ||
      !row.lastRoiPaidAt
    ) {
      return null;
    }
    const lockEnd = addMonths(row.verifiedAt, LOCK_IN_MONTHS);
    const nextDueRaw = addMonths(row.lastRoiPaidAt, 1);
    const nextRoiDueAt =
      nextDueRaw <= lockEnd && nextDueRaw <= new Date()
        ? nextDueRaw
        : nextDueRaw > lockEnd
          ? null
          : nextDueRaw;

    const monthsElapsed = wholeMonthsBetween(row.verifiedAt, new Date());
    const monthlyRoi = row.amount
      .mul(roiPercent)
      .div(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);

    return {
      startAt: row.verifiedAt.toISOString(),
      lastRoiPaidAt: row.lastRoiPaidAt.toISOString(),
      nextRoiDueAt:
        nextRoiDueAt && nextRoiDueAt <= lockEnd
          ? nextRoiDueAt.toISOString()
          : null,
      lockEndsAt: lockEnd.toISOString(),
      monthsElapsed: Math.min(monthsElapsed, LOCK_IN_MONTHS),
      monthsRemaining: Math.max(0, LOCK_IN_MONTHS - monthsElapsed),
      expectedMonthlyRoi: monthlyRoi.toString(),
    };
  }

  /** Collapse KYC states into what the admin dashboard badge understands. */
  private toFrontendKyc(status: string | null): string | null {
    if (!status) return null;
    switch (status) {
      case 'VERIFIED':
        return 'VERIFIED';
      case 'REJECTED':
        return 'REJECTED';
      default:
        // DRAFT / SUBMITTED / UNDER_REVIEW all read as "not verified yet".
        return 'PENDING';
    }
  }
}
