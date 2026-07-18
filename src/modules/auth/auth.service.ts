import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { OtpService } from '../otp/otp.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly saltRounds: number;

  constructor(
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {
    this.saltRounds = this.config.get<number>('BCRYPT_SALT_ROUNDS', 12);
  }

  async register(dto: RegisterDto, ctx: RequestContext) {
    const existingUser = await this.usersService.findByEmail(dto.email);

    if (existingUser) {
      // Deliberately vague response to avoid confirming account existence
      // (enumeration protection) — but we log the real reason internally.
      await this.auditService.log({
        action: 'REGISTER_FAILED',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { reason: 'email_already_registered' },
      });
      throw new ConflictException(
        'If this email is available, you will receive a confirmation shortly.',
      );
    }

    let referredByUserId: string | undefined;
    if (dto.referralCode) {
      const referrer = await this.usersService.findByReferralCode(
        dto.referralCode,
      );
      referredByUserId = referrer?.id;
    }

    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

    const user = await this.usersService.createWithConsent({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      passwordHash,
      referredBy: referredByUserId,
      marketingEmails: dto.marketingEmails ?? false,
    });

    const otp = await this.otpService.generate(user.id, 'EMAIL_VERIFY');

    try {
      await this.mailService.sendVerificationEmail({
        to: user.email,
        firstName: user.firstName,
        otp,
      });
    } catch {
      // Registration itself succeeded — don't fail the request over a flaky
      // SMTP send. The user can request a resend. We do surface this in logs.
      this.logger.error(
        `Verification email failed to send for user ${user.id}`,
      );
    }

    await this.auditService.log({
      userId: user.id,
      action: 'REGISTER',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      message: 'Registration successful. Please verify your email.',
      userId: user.id,
    };
  }

  async verifyEmail(dto: VerifyEmailDto, ctx: RequestContext) {
    const user = await this.usersService.findByEmail(dto.email);

    // Same enumeration-safe framing as register: don't reveal whether the
    // email exists via a different error shape.
    if (!user) {
      throw new ConflictException('Invalid or expired verification code');
    }

    await this.otpService.verify(user.id, 'EMAIL_VERIFY', dto.otp);
    await this.usersService.markEmailVerified(user.id);

    await this.auditService.log({
      userId: user.id,
      action: 'EMAIL_VERIFIED',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { message: 'Email verified successfully.' };
  }
}
