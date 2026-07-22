import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { UsersService } from '../users/users.service';
import { OtpService } from '../otp/otp.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { RefreshTokenService } from './refresh-token.service';
import { PrismaService } from '../../database/prisma.service';
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
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly saltRounds: number;
  private readonly accessExpiry: string;
  private readonly resetExpiryMinutes: number;

  constructor(
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {
    this.saltRounds = this.config.get<number>('BCRYPT_SALT_ROUNDS', 12);
    this.accessExpiry = this.config.get<string>('JWT_ACCESS_EXPIRY', '15m');
    this.resetExpiryMinutes = this.config.get<number>(
      'PASSWORD_RESET_EXPIRY_MINUTES',
      15,
    );
  }

  async register(dto: RegisterDto, ctx: RequestContext) {
    const existingUser = await this.usersService.findByEmail(dto.email);

    if (existingUser) {
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
    } catch (error) {
      this.logger.error(
        `Verification email failed to send for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
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

  async login(dto: LoginDto, ctx: RequestContext) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      await this.auditService.log({
        action: 'LOGIN_FAILED',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { reason: 'user_not_found', email: dto.email },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Account is locked. Please try again later.',
      );
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
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
      throw new UnauthorizedException(
        'Please verify your email address before logging in.',
      );
    }

    await this.usersService.recordSuccessfulLogin(user.id);

    await this.auditService.log({
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    const payload = { sub: user.id, role: user.role };
    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: this.accessExpiry,
    });

    const refreshToken = await this.refreshTokenService.create(user.id, ctx);

    return {
      message: 'Login successful',
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
        },
      },
    };
  }

  async refresh(
    rawToken: string,
    ctx: RequestContext,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const { rawToken: newRefreshToken, userId } =
      await this.refreshTokenService.validateAndRotate(rawToken, ctx);

    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const payload = { sub: user.id, role: user.role };
    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: this.accessExpiry,
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(
    rawToken: string,
    all: boolean,
    userId: string,
    ctx: RequestContext,
  ): Promise<{ message: string }> {
    if (all) {
      await this.refreshTokenService.revokeAllForUser(userId);

      await this.auditService.log({
        userId,
        action: 'LOGOUT_ALL',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return { message: 'Logged out of all sessions.' };
    }

    await this.refreshTokenService.revoke(rawToken);

    await this.auditService.log({
      userId,
      action: 'LOGOUT',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { message: 'Logged out successfully.' };
  }

  async resendOtp(dto: ResendOtpDto, ctx: RequestContext) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user || user.emailVerified) {
      return {
        message:
          'If this email is registered and unverified, a new code has been sent.',
      };
    }

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

    return {
      message:
        'If this email is registered and unverified, a new code has been sent.',
    };
  }

  async forgotPassword(dto: ForgotPasswordDto, ctx: RequestContext) {
    const user = await this.usersService.findByEmail(dto.email);

    if (user && user.status === 'ACTIVE') {
      await this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = await bcrypt.hash(rawToken, this.saltRounds);

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
    } else {
      await this.auditService.log({
        action: 'PASSWORD_RESET_REQUESTED',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    }

    return {
      message:
        "If this email is registered, you'll receive a reset link shortly.",
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

    if (!resetToken) {
      throw new BadRequestException('Invalid or expired reset link');
    }

    if (resetToken.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset link');
    }

    const tokenValid = await bcrypt.compare(dto.token, resetToken.tokenHash);

    if (!tokenValid) {
      throw new BadRequestException('Invalid or expired reset link');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, this.saltRounds);

    // Mark token consumed, update password, and revoke all refresh tokens
    // in a single transaction — a password reset must kill every other active
    // session so an attacker who already has a token cannot survive the reset.
    // TODO: When SessionService exists, also revoke Session rows here:
    //   await tx.session.updateMany({ where: { userId }, data: { revokedAt: new Date() } })
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { consumedAt: new Date() },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      await tx.refreshToken.updateMany({
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

    const isPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, this.saltRounds);

    // Update password and revoke all refresh tokens — same reasoning as
    // resetPassword: a password change must invalidate every other session.
    // TODO: When SessionService exists, also revoke Session rows here:
    //   await tx.session.updateMany({ where: { userId }, data: { revokedAt: new Date() } })
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash },
      });

      await tx.refreshToken.updateMany({
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
