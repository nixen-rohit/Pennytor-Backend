import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WithdrawalRequest, WithdrawalStatus } from '@prisma/client';
import { OtpService } from '../otp/otp.service';
import { OtpPurpose } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { verifyPassword } from '../../common/utils/password.util';
import { WithdrawalRepository } from './withdrawal.repository';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';

/** Max wrong-password verifications per user per calendar day. */
const MAX_DAILY_FAILED_VERIFICATIONS = 5;

@Injectable()
export class WithdrawalService {
  private readonly logger = new Logger(WithdrawalService.name);
  /** userId -> { day: 'YYYY-MM-DD', count } — resets each calendar day. */
  private readonly failedVerifications = new Map<
    string,
    { day: string; count: number }
  >();

  constructor(
    private readonly repository: WithdrawalRepository,
    private readonly otpService: OtpService,
    private readonly mailService: MailService,
  ) {}

  // ---------------------------------------------------------------- user

  /** Sends the withdrawal OTP to the user's registered email. */
  async sendOtp(userId: string) {
    const user = await this.repository.getUserWithPasswordHash(userId);
    if (!user?.email) throw new NotFoundException('User account not found');

    const plainOtp = await this.otpService.generate(
      userId,
      OtpPurpose.WITHDRAW_SUBMIT,
    );
    await this.mailService.sendWithdrawalOtpEmail({
      to: user.email,
      firstName: user.firstName,
      otp: plainOtp,
    });
  }

  /**
   * Verifies password and sends OTP if valid. Wrong passwords are rate
   * limited to MAX_DAILY_FAILED_VERIFICATIONS per user per day.
   */
  async verifyPasswordAndSendOtp(userId: string, password: string) {
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
    await this.sendOtp(userId);
    return { success: true };
  }

  private assertAttemptsAvailable(userId: string) {
    const rec = this.failedVerifications.get(userId);
    if (
      rec &&
      rec.day === this.today() &&
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
    const day = this.today();
    const rec = this.failedVerifications.get(userId);
    const next = rec && rec.day === day ? rec.count + 1 : 1;
    this.failedVerifications.set(userId, { day, count: next });
    return Math.max(0, MAX_DAILY_FAILED_VERIFICATIONS - next);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async getBalance(userId: string) {
    return this.repository.getBalance(userId);
  }

  async myWithdrawals(userId: string) {
    const [rows, balance] = await Promise.all([
      this.repository.listMine(userId),
      this.repository.getBalance(userId),
    ]);
    return {
      balance,
      items: rows.map((r) => this.toUserView(r)),
    };
  }

  /**
   * Creates a PENDING withdrawal request. The OTP and the account password
   * are both verified server-side, and the wallet must cover the amount.
   * The balance is debited IMMEDIATELY — refunded on admin rejection.
   */
  async createWithdrawal(userId: string, dto: CreateWithdrawalDto) {
    const user = await this.repository.getUserWithPasswordHash(userId);
    if (!user) throw new NotFoundException('User account not found');

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('Withdrawal amount must be greater than 0');
    }
    if (amount.gt(user.balance)) {
      throw new BadRequestException(
        'Insufficient wallet balance for this withdrawal',
      );
    }

    const { valid } = await verifyPassword(dto.password, user.passwordHash);
    if (!valid) {
      throw new BadRequestException('Password is incorrect');
    }

    await this.otpService.verify(userId, OtpPurpose.WITHDRAW_SUBMIT, dto.otp);

    const created = await this.repository.createWithDebit(
      userId,
      amount,
      dto.method,
      dto.destination,
      user.balance,
    );

    return {
      id: created.id,
      status: created.status,
      amount: created.amount.toString(),
    };
  }

  /** User-facing view — never storage internals or reviewer identity. */
  private toUserView(row: WithdrawalRequest) {
    return {
      id: row.id,
      amount: row.amount.toString(),
      method: row.method,
      destination: row.destination,
      status: row.status,
      reviewNote:
        row.status === WithdrawalStatus.REJECTED ? row.reviewNote : null,
      submittedAt: row.submittedAt,
      createdAt: row.createdAt,
    };
  }

  // ---------------------------------------------------------------- admin

  async listWithdrawals(query: {
    status?: WithdrawalStatus;
    search?: string;
    page: number;
    pageSize: number;
  }) {
    return this.repository.list({
      status: query.status,
      search: query.search?.trim() || undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async getWithdrawalDetail(id: string) {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException('Withdrawal request not found');
    return {
      id: row.id,
      clientId: row.user?.clientId ?? null,
      currentBalance: (row.user?.balance ?? new Prisma.Decimal(0)).toString(),
      amount: row.amount.toString(),
      method: row.method,
      destination: row.destination,
      status: row.status,
      reviewNote: row.reviewNote,
      submittedAt: row.submittedAt,
      reviewedAt: row.reviewedAt,
      createdAt: row.createdAt,
      user: row.user
        ? {
            firstName: row.user.firstName,
            lastName: row.user.lastName,
            email: row.user.email,
            clientId: row.user.clientId,
          }
        : null,
    };
  }

  /** Admin decision: UNDER_REVIEW / VERIFIED / REJECTED. */
  async updateStatus(
    id: string,
    adminId: string,
    status: WithdrawalStatus,
    note?: string,
  ) {
    const row = await this.repository.findByIdPlain(id);
    if (!row) throw new NotFoundException('Withdrawal request not found');

    if (status === WithdrawalStatus.REJECTED && !note?.trim()) {
      throw new BadRequestException(
        'A rejection reason is required for this decision',
      );
    }

    const effectiveNote = status === WithdrawalStatus.REJECTED ? note : null;

    // Approving debits the wallet exactly once: if the request was already
    // VERIFIED the transition did not happen, so no double debit.
    let updated: WithdrawalRequest;
    if (
      status === WithdrawalStatus.VERIFIED &&
      row.status !== WithdrawalStatus.VERIFIED
    ) {
      updated = await this.repository.approveAndDebit(
        id,
        row.userId,
        adminId,
        row.amount,
      );
    } else {
      updated = await this.repository.setStatus(
        id,
        status,
        adminId,
        effectiveNote,
      );
    }

    return { id: updated.id, status: updated.status };
  }

  /**
   * Approve a PENDING/UNDER_REVIEW withdrawal: atomic, race-safe
   * Money already debited at creation; this just flips status to VERIFIED.
   */
  async approve(id: string, adminId: string) {
    const row = await this.repository.findByIdPlain(id);
    if (!row) throw new NotFoundException('Withdrawal request not found');

    // Use a simpler approve that doesn't debit again
    const result = await this.repository.approveStatusOnly(row, adminId);
    if (result.conflicted) {
      throw new ConflictException(
        'Withdrawal already processed; only pending withdrawals can be approved',
      );
    }
    return { id, status: WithdrawalStatus.VERIFIED };
  }

  /** Reject a PENDING/UNDER_REVIEW withdrawal with a reason (min 3 chars). */
  async reject(id: string, adminId: string, reason: string) {
    const clean = reason.trim();
    if (clean.length < 3) {
      throw new BadRequestException(
        'A rejection reason of at least 3 characters is required',
      );
    }
    const row = await this.repository.findByIdPlain(id);
    if (!row) throw new NotFoundException('Withdrawal request not found');

    const { conflicted } = await this.repository.reject(row, adminId, clean);
    if (conflicted) {
      throw new ConflictException(
        'Withdrawal already processed; only pending withdrawals can be rejected',
      );
    }
    return { id, status: WithdrawalStatus.REJECTED };
  }
}
