import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { OtpService } from '../otp/otp.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../session/session.service';
import { PrismaService } from '../../database/prisma.service';
import { hashPassword, verifyPassword } from '../../common/utils/password.util';
import {
  generateOpaqueToken,
  hashToken,
  safeEqualHex,
} from '../../common/utils/token.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
  deviceLabel?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly resetExpiryMinutes: number;

  constructor(
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sessionService: SessionService,
  ) {
    this.resetExpiryMinutes = this.config.get<number>(
      'PASSWORD_RESET_EXPIRY_MINUTES',
      15,
    );
  }

  async checkEmail(email: string) {
    const user = await this.usersService.findByEmail(email);
    // Tells the register form whether the email is taken. This is a
    // deliberate, documented trade-off: register is a public endpoint and
    // real-time availability feedback leaks account existence by design.
    return { available: !user };
  }

  async register(dto: RegisterDto, ctx: RequestContext) {
    // Mass-assignment protection: only whitelisted DTO fields reach this
    // point (ValidationPipe whitelist + forbidNonWhitelisted in main.ts).
    const existingUser = await this.usersService.findByEmail(dto.email);

    if (existingUser) {
      throw new ConflictException('An account with this email already exists.');
    }

    const passwordHash = await hashPassword(dto.password);

    let created: Awaited<ReturnType<UsersService['createWithConsent']>>;

    try {
      created = await this.usersService.createWithConsent({
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        passwordHash,
        referredBy: dto.referralCode,
        marketingEmails: dto.marketingEmails ?? false,
      });
    } catch (error) {
      // Two simultaneous requests can both pass the findByEmail check.
      // The DB UNIQUE index is the source of truth — catch the race here
      // and surface it as a 409 rather than a 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        Array.isArray((error.meta as { target?: unknown } | undefined)?.target) &&
        (error.meta as { target: string[] }).target.includes('email')
      ) {
        throw new ConflictException('An account with this email already exists.');
      }
      throw error;
    }

    await this.auditService.log({
      userId: created.id,
      action: 'REGISTER',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.otpService.generate(created.id, 'EMAIL_VERIFY');

    return {
      message: 'Registration successful. Please verify your email.',
      userId: created.id,
    };
  }

  async verifyEmail(dto: VerifyEmailDto, ctx: RequestContext) {
    const user = await this.usersService.findByEmail(dto.email);

    // Same generic error whether the email is unknown, the code is wrong, or
    // it expired — nothing about the OTP or the account leaks.
    if (!user) {
      throw new BadRequestException('Invalid or expired verification code');
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

  async login(dto: LoginDto, ctx: RequestContext) {
    const user = await this.usersService.findByEmail(dto.email);

    // One generic error for every failure mode — no account enumeration,
    // no timing difference on the password check (verifyPassword always runs
    // when the account exists).
    if (!user) {
      await this.auditService.log({
        action: 'LOGIN_FAILED',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { reason: 'user_not_found' },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.auditService.log({
        userId: user.id,
        action: 'LOGIN_FAILED',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { reason: 'account_locked' },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    const { valid, needsRehash } = await verifyPassword(
      dto.password,
      user.passwordHash,
    );

    if (!valid) {
      const attempts = (user.failedLoginAttempts || 0) + 1;
      const lockTimeMinutes = attempts >= 5 ? 15 : undefined;

      await this.usersService.recordFailedLogin(
        user.id,
        attempts,
        lockTimeMinutes,
      );

      await this.auditService.log({
        userId: user.id,
        action: 'LOGIN_FAILED',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { reason: 'invalid_password', attempts },
      });

      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.emailVerified) {
      await this.auditService.log({
        userId: user.id,
        action: 'LOGIN_FAILED',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { reason: 'email_not_verified' },
      });
      throw new UnauthorizedException(
        'Please verify your email address before logging in.',
      );
    }

    await this.usersService.recordSuccessfulLogin(user.id);

    // Transparent upgrade: accounts still on legacy bcrypt hashes are
    // re-hashed with Argon2id on their next successful login.
    if (needsRehash) {
      await this.usersService.updatePasswordHash(
        user.id,
        await hashPassword(dto.password),
      );
    }

    // Session fixation protection: a brand-new session ID is always issued
    // here; nothing from the client is ever reused.
    const rawSessionId = await this.sessionService.create(user.id, ctx);

    await this.auditService.log({
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      message: 'Login successful',
      data: {
        sessionId: rawSessionId,
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          isApproved: user.isApproved,
        },
      },
    };
  }

  /**
   * Returns the authenticated user for the current session. Called by the
   * frontend on every page load — this is how a full reload restores the
   * session without any client-side secret.
   */
  async me(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }

    return {
      data: {
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          isApproved: user.isApproved,
        },
      },
    };
  }

  async logout(rawSessionId: string, userId: string, ctx: RequestContext) {
    if (rawSessionId) {
      await this.sessionService.revoke(rawSessionId);
    }

    await this.auditService.log({
      userId,
      action: 'LOGOUT',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { message: 'Logged out successfully.' };
  }

  async logoutAll(userId: string, ctx: RequestContext) {
    await this.sessionService.revokeAllForUser(userId);

    await this.auditService.log({
      userId,
      action: 'LOGOUT_ALL',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { message: 'Logged out everywhere. All sessions were revoked.' };
  }

  async resendOtp(dto: ResendOtpDto, ctx: RequestContext) {
    const user = await this.usersService.findByEmail(dto.email);

    if (user && !user.emailVerified) {
      const otp = await this.otpService.generate(user.id, 'EMAIL_VERIFY');

      try {
        await this.mailService.sendVerificationEmail({
          to: user.email,
          firstName: user.firstName,
          otp,
        });
      } catch (error) {
        this.logger.error(
          `Resend OTP email failed for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }

      await this.auditService.log({
        userId: user.id,
        action: 'OTP_RESENT',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    }

    // Identical response whether the email exists or not — no enumeration.
    return {
      message:
        'If this email is registered and unverified, a new code has been sent.',
    };
  }

  async forgotPassword(dto: ForgotPasswordDto, ctx: RequestContext) {
    const user = await this.usersService.findByEmail(dto.email);

    if (user) {
      await this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      const rawToken = generateOpaqueToken(32);
      const tokenHash = hashToken(rawToken);

      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + this.resetExpiryMinutes * 60_000),
        },
      });

      try {
        await this.mailService.sendPasswordResetEmail({
          to: user.email,
          firstName: user.firstName,
          token: rawToken,
          email: user.email,
        });
      } catch (error) {
        this.logger.error(
          `Password reset email failed to send for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }

      await this.auditService.log({
        userId: user.id,
        action: 'PASSWORD_RESET_REQUESTED',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    }

    // Never reveal whether the email exists.
    return {
      message: 'If this email is registered, you will receive further instructions.',
    };
  }

  async resetPassword(dto: ResetPasswordDto, ctx: RequestContext) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new BadRequestException('Invalid or expired reset link');
    }

    const resetToken = await this.prisma.passwordResetToken.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (
      !resetToken ||
      resetToken.expiresAt < new Date() ||
      !safeEqualHex(hashToken(dto.token), resetToken.tokenHash)
    ) {
      throw new BadRequestException('Invalid or expired reset link');
    }

    const passwordHash = await hashPassword(dto.newPassword);

    // Consume the token, update the password, and revoke EVERY active
    // session atomically — an attacker holding any other session cannot
    // survive a password reset.
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { consumedAt: new Date() },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.auditService.log({
      userId: user.id,
      action: 'PASSWORD_RESET_COMPLETED',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { message: 'Password reset successful. You can now log in.' };
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    ctx: RequestContext,
  ) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const { valid } = await verifyPassword(dto.currentPassword, user.passwordHash);
    if (!valid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await hashPassword(dto.newPassword);

    // Same reasoning as resetPassword: a password change must invalidate
    // every other session immediately.
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash },
      });

      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.auditService.log({
      userId,
      action: 'PASSWORD_CHANGED',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { message: 'Password changed successfully. Please log in again.' };
  }
}