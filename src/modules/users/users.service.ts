import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, User } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, User } from '@prisma/client';
import { generateReferralCode } from '@common/utils/referral-code.util';

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

  findByReferralCode(code: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { ownReferralCode: code.toUpperCase().trim() },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Creates the user + their consent record in a single transaction —
   * we never want a user to exist without a recorded consent decision.
   */
  async createWithConsent(params: {
    firstName: string;
    lastName: string;
    email: string;
    passwordHash: string;
    referredBy?: string;
    marketingEmails: boolean;
  }): Promise<User> {
    const referralCode = await this.generateUniqueReferralCode();

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          firstName: params.firstName,
          lastName: params.lastName,
          email: params.email.toLowerCase().trim(),
          passwordHash: params.passwordHash,
          ownReferralCode: referralCode,
          referredBy: params.referredBy,
          role: 'USER', // never accept role from the client — see RegisterDto, it has no role field
        },
      });

      await tx.userConsent.create({
        data: {
          userId: user.id,
          termsAccepted: true,
          termsAcceptedAt: new Date(),
          privacyPolicyAccepted: true,
          privacyPolicyAcceptedAt: new Date(),
          marketingEmails: params.marketingEmails,
        },
      });

      return user;
    });
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

  /** Retries on the rare unique-constraint collision rather than trusting randomness alone. */
  private async generateUniqueReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateReferralCode();
      const existing = await this.prisma.user.findUnique({
        where: { ownReferralCode: code },
        select: { id: true },
      });
      if (!existing) return code;
    }
    throw new Prisma.PrismaClientKnownRequestError(
      'Failed to generate a unique referral code after 5 attempts',
      { code: 'P2002', clientVersion: 'n/a' },
    );
  }

  async approveUser(userId: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    
    if (user.isApproved) {
      return { message: 'User is already approved', clientId: user.clientId };
    }

    const clientId = await this.generateUniqueClientId();

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isApproved: true,
        approvedAt: new Date(),
        clientId,
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
      const clientId = Math.floor(100000 + Math.random() * 900000).toString();
      const existing = await this.prisma.user.findUnique({
        where: { clientId },
        select: { id: true },
      });
      if (!existing) return clientId;
    }
    throw new Error('Failed to generate a unique Client ID');
  }
}
