import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { OtpPurpose, SIPStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { OtpService } from '../otp/otp.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { SIPForChildRepository } from './sip-for-child.repository';
import { ReferralService } from '../referral/referral.service';
import { KycService } from '../kyc/kyc.service';
import { verifyPassword } from '../../common/utils/password.util';
import {
  CreateSIPForChildApplicationDto,
  VerifyPasswordDto,
  PayPremiumDto,
} from './dto/sip-for-child.dto';

const TOTAL_MONTHS = 120; // 10 years

export interface SIPForChildScheme {
  id: 'PLAN_5000' | 'PLAN_2500';
  name: string;
  monthlyInvestment: number;
  investmentYears: number;
  annualReturn: number;
  fundValue: number;
  withdrawalMonthly: number;
  withdrawalYears: number;
  finalAmount: number;
}

@Injectable()
export class SIPForChildService {
  private readonly logger = new Logger(SIPForChildService.name);
  /** userId -> { day: 'YYYY-MM-DD', count } — resets each calendar day. */
  private readonly failedVerifications = new Map<
    string,
    { day: string; count: number }
  >();

  constructor(
    private readonly repository: SIPForChildRepository,
    private readonly otpService: OtpService,
    private readonly mailService: MailService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly referralService: ReferralService,
    private readonly kycService: KycService,
  ) {}

  async getSchemes(): Promise<SIPForChildScheme[]> {
    return [
      {
        id: 'PLAN_5000',
        name: 'SIP ₹5,000/month',
        monthlyInvestment: 5000,
        investmentYears: 10,
        annualReturn: 22,
        fundValue: 2179000,
        withdrawalMonthly: 50000,
        withdrawalYears: 10,
        finalAmount: 1117000,
      },
      {
        id: 'PLAN_2500',
        name: 'SIP ₹2,500/month',
        monthlyInvestment: 2500,
        investmentYears: 10,
        annualReturn: 22,
        fundValue: 1089000,
        withdrawalMonthly: 25000,
        withdrawalYears: 10,
        finalAmount: 400000,
      },
    ];
  }

  async verifyPasswordAndSendOtp(
    userId: string,
    password: string,
    scheme: string,
    amount?: string,
  ): Promise<{ success: boolean }> {
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

    const plainOtp = await this.otpService.generate(
      userId,
      OtpPurpose.WITHDRAW_SUBMIT,
    );

    if (scheme) {
      const schemeData = (await this.getSchemes()).find((s) => s.id === scheme);

      await this.mailService.sendSipForChildOtpEmail({
        to: user.email,
        firstName: user.firstName,
        otp: plainOtp,
        scheme: `SIP for Child - ${schemeData?.name || scheme}`,
        monthlyPremium:
          schemeData?.monthlyInvestment.toLocaleString('en-IN') || 'N/A',
        duration: '10 Years (120 months)',
        annualReturn: schemeData?.annualReturn || 22,
      });
    } else {
      await this.mailService.sendWithdrawalOtpEmail({
        to: user.email,
        firstName: user.firstName,
        otp: plainOtp,
      });
    }

    return { success: true };
  }

  /**
   * Create application — NO wallet debit. Just creates a PENDING application.
   * Wallet is debited when user pays monthly premiums.
   */
  async createApplication(
    userId: string,
    dto: CreateSIPForChildApplicationDto,
  ): Promise<{ id: string; status: string; amount: string }> {
    this.assertAttemptsAvailable(userId);

    // Spec §9: KYC must be verified before any investment.
    await this.kycService.assertKycVerified(userId);

    const user = await this.repository.getUserWithPasswordHash(userId);
    if (!user) throw new NotFoundException('User account not found');

    const scheme = (await this.getSchemes()).find((s) => s.id === dto.scheme);
    if (!scheme) throw new BadRequestException('Invalid scheme');

    // Verify password
    const { valid } = await verifyPassword(dto.password, user.passwordHash);
    if (!valid) {
      const remaining = this.registerFailure(userId);
      throw new BadRequestException(
        `Password is incorrect. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining today.`,
      );
    }

    this.failedVerifications.delete(userId);

    // Verify OTP
    await this.otpService.verify(userId, OtpPurpose.WITHDRAW_SUBMIT, dto.otp);

    // Check for existing active application
    const existing = await this.repository.findActiveByUserAndScheme(
      userId,
      dto.scheme,
    );
    if (existing) {
      throw new BadRequestException(
        'You already have an active SIP for Child application for this scheme.',
      );
    }

    // Create application (NO wallet debit — premiums are paid separately)
    const created = await this.repository.create(userId, {
      scheme: dto.scheme,
      amount: new Prisma.Decimal(scheme.monthlyInvestment),
      method: 'sip-for-child',
      destination: `Scheme ${dto.scheme}`,
      submittedAt: new Date(),
    });

    return {
      id: created.id,
      status: created.status,
      amount: created.amount.toString(),
    };
  }

  /**
   * Pay a monthly premium. Requires OTP verification.
   * Debits wallet and records the premium payment.
   */
  async payPremium(
    userId: string,
    applicationId: string,
    dto: PayPremiumDto,
  ): Promise<{
    success: boolean;
    monthNumber: number;
    nextMonth: number | null;
    advanced: boolean;
  }> {
    // Spec §9: KYC must be verified before any premium payment.
    await this.kycService.assertKycVerified(userId);

    const user = await this.repository.getUserWithPasswordHash(userId);
    if (!user) throw new NotFoundException('User account not found');

    const app = await this.repository.findById(applicationId);
    if (!app) throw new NotFoundException('Application not found');
    if (app.userId !== userId) throw new BadRequestException('Unauthorized');
    if (app.status !== SIPStatus.VERIFIED) {
      throw new BadRequestException('Application is not active');
    }

    // Check if SIP is complete
    if (app.monthsPaid >= app.totalMonths) {
      throw new BadRequestException('SIP is already complete');
    }

    const scheme = (await this.getSchemes()).find((s) => s.id === app.scheme);
    const monthlyAmount = new Prisma.Decimal(
      scheme?.monthlyInvestment || app.amount,
    );

    // Verify password
    const { valid } = await verifyPassword(dto.password, user.passwordHash);
    if (!valid) throw new BadRequestException('Password is incorrect');

    // Verify OTP
    await this.otpService.verify(userId, OtpPurpose.WITHDRAW_SUBMIT, dto.otp);

    // Check wallet balance
    if (user.balance.lessThan(monthlyAmount)) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    // Find the next unpaid month — if current is already paid, auto-advance
    let nextMonth = app.monthsPaid + 1;
    let advanced = false;
    const existingPremium = app.premiums?.find(
      (p) => p.monthNumber === nextMonth && p.status === 'PAID',
    );
    if (existingPremium) {
      // Current month already paid — find the next unpaid month
      const paidMonthNumbers = new Set(
        (app.premiums ?? [])
          .filter((p) => p.status === 'PAID')
          .map((p) => p.monthNumber),
      );
      while (nextMonth <= app.totalMonths && paidMonthNumbers.has(nextMonth)) {
        nextMonth++;
      }
      if (nextMonth > app.totalMonths) {
        throw new BadRequestException('All months are already paid');
      }
      advanced = true;
    }

    // Atomic: debit wallet + record premium + update counters + ledger entry (all inside one transaction)
    const result = await this.repository.payPremium(
      applicationId,
      userId,
      monthlyAmount,
      nextMonth,
    );

    // Audit trail
    await this.auditService.log({
      userId,
      action: 'SIP_PREMIUM_PAID' as any,
      metadata: {
        applicationId,
        monthNumber: nextMonth,
        amount: monthlyAmount.toString(),
        advanced,
        balanceAfter: result.balanceAfter.toString(),
      },
    });

    // Send confirmation email (best-effort)
    try {
      const newMonthsPaid =
        result.nextMonth === null ? app.totalMonths : nextMonth - 1;
      const monthsRemaining = app.totalMonths - newMonthsPaid;
      let nextDue = 'Completed';
      if (result.nextMonth) {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        d.setDate(1);
        nextDue = d.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        });
      }

      await this.mailService.sendSipForChildPremiumPaidEmail({
        to: user.email,
        firstName: user.firstName,
        planName: `SIP for Child - ${scheme?.name || app.scheme}`,
        amountPaid: monthlyAmount.toString(),
        monthNumber: nextMonth,
        totalMonths: app.totalMonths,
        paymentDate: new Date().toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }),
        isAdvance: advanced,
        totalPaid: monthlyAmount.mul(newMonthsPaid).toString(),
        monthsRemaining,
        nextPaymentDue: nextDue,
        monthsPaid: newMonthsPaid,
      });
    } catch (error) {
      this.logger.error(`Premium confirmation email failed: ${error}`);
    }

    return {
      success: result.success,
      monthNumber: nextMonth,
      nextMonth: result.nextMonth,
      advanced,
    };
  }

  /**
   * User dashboard feed — applications with premium tracking.
   */
  async myApplications(userId: string) {
    const rows = await this.repository.listMine(userId);
    const schemes = await this.getSchemes();

    const items = rows.map((r) => {
      const scheme = schemes.find((s) => s.id === r.scheme);
      const monthlyRoi = r.amount
        .mul(scheme?.annualReturn || 0)
        .div(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);

      return {
        id: r.id,
        scheme: r.scheme,
        planLabel: `SIP ${r.scheme}`,
        monthlyInvestment: r.amount.toString(),
        totalInvested: r.amount.mul(r.monthsPaid).toString(),
        fundValue: scheme?.fundValue.toString() || '0',
        roiPercent: scheme?.annualReturn || 0,
        monthlyRoi: monthlyRoi.toString(),
        lockInMonths: TOTAL_MONTHS,
        totalMonths: r.totalMonths,
        monthsPaid: r.monthsPaid,
        monthsMissed: r.monthsMissed,
        nextPaymentDue: r.nextPaymentDue?.toISOString() || null,
        startedAt: r.startedAt?.toISOString() || null,
        lastPaidAt: r.lastPaidAt?.toISOString() || null,
        status: r.status,
        debited: r.monthsPaid > 0,
        refunded: r.status === SIPStatus.REJECTED,
        reviewNote: r.status === SIPStatus.REJECTED ? r.reviewNote : null,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        totalRoiPaid: '0',
        premiums:
          r.premiums?.map((p) => ({
            id: p.id,
            monthNumber: p.monthNumber,
            amount: p.amount.toString(),
            status: p.status,
            paidAt: p.paidAt?.toISOString() || null,
          })) || [],
        cycle: r.startedAt
          ? {
              startAt: r.startedAt.toISOString(),
              monthsElapsed: r.monthsPaid,
              monthsRemaining: r.totalMonths - r.monthsPaid,
              nextPaymentDue: r.nextPaymentDue?.toISOString() || null,
              lastPaidAt: r.lastPaidAt?.toISOString() || null,
            }
          : null,
      };
    });

    return { items };
  }

  /**
   * User transaction report — premium payments, refunds.
   */
  async myReports(userId: string) {
    const premiums = await this.repository.premiumsForUser(userId);
    const applications = await this.repository.listMine(userId);

    const entries: any[] = [];

    // Premium payments
    for (const p of premiums) {
      entries.push({
        id: `sip-premium-${p.id}`,
        kind: 'SIP_PREMIUM',
        planLabel: `SIP for Child Scheme(${p.application?.scheme || '?'})`,
        direction: p.status === 'REFUNDED' ? 'CREDIT' : 'DEBIT',
        amount: p.amount.toString(),
        status: p.status === 'REFUNDED' ? 'REFUNDED' : null,
        occurredAt: (p.paidAt || p.createdAt).toISOString(),
        monthNumber: p.monthNumber,
      });
    }

    // Application submissions (no debit, just record)
    for (const app of applications) {
      entries.push({
        id: `sip-app-${app.id}`,
        kind: 'SIP_APPLICATION',
        planLabel: `SIP for Child Scheme(${app.scheme})`,
        direction: 'INFO',
        amount: '0',
        status: app.status,
        occurredAt: (app.submittedAt || app.createdAt).toISOString(),
      });
    }

    entries.sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );

    return { items: entries };
  }

  // ------------------------------------------------------------- scheduler

  /**
   * Called by the missed-payment scheduler. Finds all VERIFIED applications
   * whose nextPaymentDue is in the past and marks each overdue month as missed.
   * If the 4th miss threshold is hit, the application is auto-rejected and
   * refunded inside the repository transaction.
   */
  async processMissedPayments(): Promise<{
    checked: number;
    missed: number;
    rejected: number;
  }> {
    const apps = await this.repository.findApplicationsWithDuePremiums();
    const now = new Date();
    let missed = 0;
    let rejected = 0;

    for (const app of apps) {
      if (!app.nextPaymentDue || app.nextPaymentDue > now) continue;

      const result = await this.repository.markMonthMissed(app.id);
      if (result.skipped || result.monthsMissed === 0) continue;

      missed++;

      // Re-fetch fresh data for emails (the app object is stale after markMonthMissed)
      const freshApp = await this.repository.findById(app.id);
      if (!freshApp) continue;

      // Send email notification (best-effort)
      try {
        const scheme = (await this.getSchemes()).find(
          (s) => s.id === app.scheme,
        );
        const dueDate = app.nextPaymentDue!.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        });

        if (result.rejected) {
          const paidPremiums =
            freshApp.premiums?.filter((p) => p.status === 'PAID') || [];
          const refundTotal = paidPremiums.reduce(
            (sum, p) => sum.add(p.amount),
            new (require('@prisma/client').Prisma.Decimal)(0),
          );
          await this.mailService.sendSipForChildAutoRejectedEmail({
            to: app.user.email,
            firstName: app.user.firstName,
            planName: `SIP for Child - ${scheme?.name || app.scheme}`,
            monthsPaid: freshApp.monthsPaid,
            totalMonths: freshApp.totalMonths,
            monthsMissed: result.monthsMissed,
            refundAmount: refundTotal.toLocaleString('en-IN'),
          });
          rejected++;
        } else {
          await this.mailService.sendSipForChildMissedPaymentEmail({
            to: app.user.email,
            firstName: app.user.firstName,
            planName: `SIP for Child - ${scheme?.name || app.scheme}`,
            missedMonth: freshApp.monthsPaid + 1,
            totalMonths: freshApp.totalMonths,
            dueDate,
            monthlyPremium:
              scheme?.monthlyInvestment.toLocaleString('en-IN') || '0',
            monthsMissed: result.monthsMissed,
          });
        }
      } catch (error) {
        this.logger.error(
          `Missed-payment email failed for ${app.id}: ${error}`,
        );
      }
    }

    return { checked: apps.length, missed, rejected };
  }

  // ------------------------------------------------------------- admin

  async adminList(query: {
    status?: SIPStatus;
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
        monthlyInvestment: r.amount.toString(),
        monthsPaid: r.monthsPaid,
        monthsMissed: r.monthsMissed,
        totalMonths: r.totalMonths,
        kycStatus: this.toFrontendKyc(r.user.kycApplication?.status ?? null),
        status: r.status,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
    };
  }

  async adminDetail(id: string) {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException('Application not found');

    const scheme = (await this.getSchemes()).find((s) => s.id === row.scheme);

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
      totalMonths: row.totalMonths,
      monthsPaid: row.monthsPaid,
      monthsMissed: row.monthsMissed,
      nextPaymentDue: row.nextPaymentDue?.toISOString() ?? null,
      startedAt: row.startedAt?.toISOString() ?? null,
      lastPaidAt: row.lastPaidAt?.toISOString() ?? null,
      user: {
        firstName: row.user.firstName,
        lastName: row.user.lastName,
        email: row.user.email,
        clientId: row.user.clientId,
      },
      kycStatus: this.toFrontendKyc(row.user.kycApplication?.status ?? null),
      schemeInfo: {
        label: `Plan ${row.scheme}`,
        name: scheme?.name || row.scheme,
        monthlyInvestment: scheme?.monthlyInvestment || 0,
        totalMonths: TOTAL_MONTHS,
        annualReturn: scheme?.annualReturn || 0,
        fundValue: scheme?.fundValue || 0,
      },
      premiums:
        row.premiums?.map((p) => ({
          id: p.id,
          monthNumber: p.monthNumber,
          amount: p.amount.toString(),
          status: p.status,
          paidAt: p.paidAt?.toISOString() || null,
        })) || [],
    };
  }

  async approve(id: string, adminId: string) {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException('Application not found');

    const { conflicted, application } =
      await this.repository.approveAndStartCycle(row, adminId);
    if (conflicted || !application) {
      throw new ConflictException(
        'Application already processed; only pending applications can be approved',
      );
    }

    // Spec §10: on first verified investment, generate the referral
    // code and activate eligibility. Idempotent.
    await this.referralService.onInvestmentVerified(application.userId);

    // Send approval email (best-effort)
    try {
      const scheme = (await this.getSchemes()).find((s) => s.id === row.scheme);
      const now = new Date();
      const maturityDate = new Date(now);
      maturityDate.setFullYear(maturityDate.getFullYear() + 10);
      const firstPremiumDue = new Date(now);
      firstPremiumDue.setDate(1);
      firstPremiumDue.setMonth(firstPremiumDue.getMonth() + 1);

      await this.mailService.sendSipForChildApprovedEmail({
        to: row.user.email,
        firstName: row.user.firstName,
        planName: `SIP for Child - ${scheme?.name || row.scheme}`,
        monthlyPremium:
          scheme?.monthlyInvestment.toLocaleString('en-IN') || 'N/A',
        duration: '10 Years',
        totalMonths: TOTAL_MONTHS,
        annualReturn: scheme?.annualReturn || 22,
        fundValue: scheme?.fundValue.toLocaleString('en-IN') || 'N/A',
        cycleStartDate: now.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }),
        firstPremiumDue: firstPremiumDue.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }),
        maturityDate: maturityDate.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }),
      });
    } catch (error) {
      this.logger.error(`Approval email failed for application ${row.id}`);
    }

    return { id, status: SIPStatus.VERIFIED };
  }

  async reject(id: string, adminId: string, reason?: string) {
    const clean = (reason || '').trim();
    if (clean.length < 3) {
      throw new BadRequestException(
        'A rejection reason of at least 3 characters is required',
      );
    }
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException('Application not found');

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

    // Spec §11: recompute eligibility (may INACTIVE the code).
    await this.referralService.onInvestmentDeactivated(row.userId);

    return { id, status: SIPStatus.REJECTED };
  }

  // ------------------------------------------------------------- helpers

  private assertAttemptsAvailable(userId: string) {
    const rec = this.failedVerifications.get(userId);
    if (
      rec &&
      rec.day === new Date().toISOString().slice(0, 10) &&
      rec.count >= 5
    ) {
      throw new BadRequestException(
        'Too many incorrect password attempts today. Please try again tomorrow.',
      );
    }
  }

  private registerFailure(userId: string): number {
    const day = new Date().toISOString().slice(0, 10);
    const rec = this.failedVerifications.get(userId);
    const next = rec && rec.day === day ? rec.count + 1 : 1;
    this.failedVerifications.set(userId, { day, count: next });
    return Math.max(0, 5 - next);
  }

  private toFrontendKyc(status: string | null): string | null {
    if (!status) return null;
    switch (status) {
      case 'VERIFIED':
        return 'VERIFIED';
      case 'REJECTED':
        return 'REJECTED';
      default:
        return 'PENDING';
    }
  }
}
