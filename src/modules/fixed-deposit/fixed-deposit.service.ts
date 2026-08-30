import { Injectable, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { FixedDepositPlanId, OtpPurpose } from '@prisma/client';
import { FixedDepositRepository, FDScheme } from './fixed-deposit.repository';
import { OtpService } from '../otp/otp.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { verifyPassword } from '../../common/utils/password.util';

@Injectable()
export class FixedDepositService {
  private readonly failedVerifications = new Map<string, { count: number; resetAt: Date }>();
  private readonly MAX_ATTEMPTS = 5;

  constructor(
    private readonly repo: FixedDepositRepository,
    private readonly otpService: OtpService,
    private readonly mailService: MailService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  getSchemes(): FDScheme[] {
    return this.repo.getSchemes();
  }

  async verifyPasswordAndSendOtp(userId: string, password: string, planId: FixedDepositPlanId) {
    const existing = await this.repo.findActiveByUser(userId, planId);
    if (existing) {
      throw new ConflictException('You already have an active Fixed Deposit application for this plan');
    }

    this.assertAttemptsAvailable(userId);

    const user = await this.repo.getUserWithPasswordHash(userId);
    if (!user) throw new NotFoundException('User account not found');

    if (!(user as any).emailVerified) {
      throw new BadRequestException('Please verify your email before applying');
    }

    const { valid } = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      const remaining = this.registerFailure(userId);
      throw new BadRequestException(
        `Password is incorrect. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining today.`,
      );
    }

    this.failedVerifications.delete(userId);

    const plainOtp = await this.otpService.generate(userId, OtpPurpose.WITHDRAW_SUBMIT);

    const scheme = this.repo.getSchemeById(planId);
    await this.mailService.sendFDOTPEmail(user.email, plainOtp, {
      firstName: user.firstName,
      planId,
      depositAmount: scheme?.depositAmount ?? 0,
    });

    return { message: 'OTP sent to email' };
  }

  async createApplication(userId: string, planId: FixedDepositPlanId, password: string, otp: string) {
    const existing = await this.repo.findActiveByUser(userId, planId);
    if (existing) {
      throw new ConflictException('You already have an active Fixed Deposit application for this plan');
    }

    this.assertAttemptsAvailable(userId);

    const user = await this.repo.getUserWithPasswordHash(userId);
    if (!user) throw new NotFoundException('User account not found');

    if (!(user as any).emailVerified) {
      throw new BadRequestException('Please verify your email before applying');
    }

    const { valid } = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      const remaining = this.registerFailure(userId);
      throw new BadRequestException(
        `Password is incorrect. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining today.`,
      );
    }

    this.failedVerifications.delete(userId);

    await this.otpService.verify(userId, OtpPurpose.WITHDRAW_SUBMIT, otp);

    const application = await this.repo.create(userId, planId);

    const scheme = this.repo.getSchemeById(planId);
    await this.mailService.sendFDAppliedEmail(user.email, {
      firstName: user.firstName,
      applicationId: application.id,
      planId,
      depositAmount: scheme?.depositAmount ?? 0,
      lockInMonths: scheme?.lockInMonths ?? 0,
    });

    return application;
  }

  async myApplications(userId: string) {
    return this.repo.listMine(userId);
  }

  async myReports(userId: string, page = 1, pageSize = 20) {
    return this.repo.list({ userId, page, pageSize });
  }

  async getApplicationDetail(id: string) {
    return this.repo.findById(id);
  }

  // Admin
  async listApplications(query: { status?: string; search?: string; page: number; pageSize: number }) {
    const status = query.status && query.status !== 'ALL'
      ? query.status as any
      : undefined;
    const result = await this.repo.list({ status, search: query.search, page: query.page, pageSize: query.pageSize });
    return {
      ...result,
      items: result.items.map((item: any) => ({
        ...item,
        applicantName: item.user ? `${item.user.firstName} ${item.user.lastName}` : '',
        applicantEmail: item.user?.email ?? '',
      })),
    };
  }

  async approveApplication(id: string, adminId: string) {
    const result = await this.repo.approveAndStartCycle(id, adminId);
    if (result.conflicted) {
      throw new ConflictException('Application is no longer pending');
    }

    this.audit.log({ action: 'APPROVE_DEPOSIT', userId: adminId, metadata: { targetId: id, planId: result.application?.planId } });

    const app = result.application;
    if (app) {
      const user = await this.repo.getUserWithPasswordHash(app.userId);
      if (user) {
        await this.mailService.sendFDApprovedEmail(user.email, {
          firstName: user.firstName,
          applicationId: app.id,
          planId: app.planId,
          depositAmount: Number(app.depositAmount),
          lockInMonths: app.lockInMonths,
          payoutMode: app.payoutMode,
          emiAmount: Number(app.emiAmount),
          totalEmis: app.totalEmis,
          totalPayout: Number(app.totalPayout),
          nextPayoutAt: app.nextPayoutAt,
        });
      }
    }

    return result.application;
  }

  async rejectApplication(id: string, adminId: string, reason: string) {
    const result = await this.repo.rejectAndRefund(id, adminId, reason);
    if (result.conflicted) {
      throw new ConflictException('Application is no longer pending');
    }

    this.audit.log({ action: 'REJECT_DEPOSIT', userId: adminId, metadata: { targetId: id, reason } });

    return { message: 'Application rejected' };
  }

  // Scheduler
  async processPayouts() {
    const apps = await this.repo.findDuePayouts();
    let credited = 0;
    let skipped = 0;

    for (const app of apps) {
      if (!app.payouts[0]) { skipped++; continue; }

      try {
        const result = await this.repo.creditPayout(app.id, app.payouts[0].emiNumber);
        if (!result) { skipped++; continue; }
        credited++;

        // Email (best-effort)
        try {
          if (result.isComplete) {
            await this.mailService.sendFDMaturedEmail(app.user.email, {
              firstName: app.user.firstName,
              applicationId: app.id,
              planId: app.planId,
              totalPayout: Number(app.totalPayout),
              depositAmount: Number(app.depositAmount),
            });
          } else {
            await this.mailService.sendFDEMICreditedEmail(app.user.email, {
              firstName: app.user.firstName,
              applicationId: app.id,
              planId: app.planId,
              emiNumber: app.payouts[0].emiNumber,
              amount: Number(app.payouts[0].amount),
              newBalance: Number(result.balanceAfter),
            });
          }
        } catch (e) { /* email best-effort */ }
      } catch (e) {
        skipped++;
      }
    }

    return { total: apps.length, credited, skipped };
  }

  // ─── Password attempt tracking (in-memory, same as SIP) ──────────────────

  private assertAttemptsAvailable(userId: string) {
    const entry = this.failedVerifications.get(userId);
    if (!entry) return;

    if (new Date() > entry.resetAt) {
      this.failedVerifications.delete(userId);
      return;
    }

    if (entry.count >= this.MAX_ATTEMPTS) {
      throw new BadRequestException(
        `Too many failed attempts. Try again after ${entry.resetAt.toLocaleTimeString()}.`,
      );
    }
  }

  private registerFailure(userId: string): number {
    const now = new Date();
    const entry = this.failedVerifications.get(userId);

    if (!entry || now > entry.resetAt) {
      const resetAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      this.failedVerifications.set(userId, { count: 1, resetAt });
      return this.MAX_ATTEMPTS - 1;
    }

    entry.count++;
    return this.MAX_ATTEMPTS - entry.count;
  }
}
