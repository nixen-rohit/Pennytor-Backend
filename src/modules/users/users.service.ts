import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, User } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { generateClientId } from '../../common/utils/client-id.util';

/**
 * Spec §2: a referral code MUST NOT be generated at registration.
 * Instead, it is generated later, when the user's first investment is
 * admin-verified. This service creates the user with `referralCode =
 * null`; the referral module will fill it in on `onInvestmentVerified`.
 *
 * The userType field is also NOT set by the registration form — every
 * public registration creates a `pennytor_user`. SUPER_USER accounts
 * are created through a separate admin path (see SuperUserService).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
  }

  /** Spec §1: ADMIN users do not have — and cannot be issued — a code. */
  async findByReferralCodeAndEligible(code: string) {
    return this.prisma.user.findFirst({
      where: {
        referralCode: code,
        role: { not: 'ADMIN' },
        referralCodeStatus: 'ACTIVE',
      },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  markEmailVerified(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true, status: 'ACTIVE' },
    });
  }

  updatePasswordHash(userId: string, passwordHash: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  recordSuccessfulLogin(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
  }

  recordFailedLogin(
    userId: string,
    attempts: number,
    lockTimeMinutes?: number,
  ): Promise<User> {
    const data: Prisma.UserUpdateInput = {
      failedLoginAttempts: attempts,
    };

    if (lockTimeMinutes) {
      const lockUntil = new Date();
      lockUntil.setMinutes(lockUntil.getMinutes() + lockTimeMinutes);
      data.lockedUntil = lockUntil;
    }

    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  async approveUser(userId: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isApproved) {
      return { message: 'User is already approved', clientId: user.clientId };
    }

    const clientId = user.clientId ?? (await this.generateUniqueClientId());

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isApproved: true,
        ...(user.clientId ? {} : { clientId }),
      },
    });

    await this.mailService.sendAccountApprovedEmail({
      to: updatedUser.email,
      firstName: updatedUser.firstName,
      clientId,
    });

    return { message: 'User approved and email sent', clientId };
  }

  private async generateUniqueClientId(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const clientId = generateClientId();
      const existing = await this.prisma.user.findUnique({
        where: { clientId },
        select: { id: true },
      });
      if (!existing) return clientId;
    }
    throw new Error('Failed to generate a unique Client ID');
  }
}
