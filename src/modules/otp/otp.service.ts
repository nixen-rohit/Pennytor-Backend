import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { OtpPurpose } from '@prisma/client';

@Injectable()
export class OtpService {
  private readonly expiryMinutes: number;
  private readonly maxAttempts: number;
  private readonly length: number;
  private readonly saltRounds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.expiryMinutes = this.config.get<number>('OTP_EXPIRY_MINUTES', 5);
    this.maxAttempts = this.config.get<number>('OTP_MAX_ATTEMPTS', 5);
    this.length = this.config.get<number>('OTP_LENGTH', 6);
    this.saltRounds = this.config.get<number>('BCRYPT_SALT_ROUNDS', 12);
  }

  /**
   * Invalidates any prior unconsumed OTPs of the same purpose for this user
   * before issuing a new one — prevents a stale earlier code from still
   * being valid alongside a freshly requested one.
   */
  async generate(userId: string, purpose: OtpPurpose): Promise<string> {
    await this.prisma.otp.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const plainOtp = this.generateNumericCode(this.length);
    const otpHash = await bcrypt.hash(plainOtp, this.saltRounds);

    await this.prisma.otp.create({
      data: {
        userId,
        purpose,
        otpHash,
        expiresAt: new Date(Date.now() + this.expiryMinutes * 60_000),
        maxAttempts: this.maxAttempts,
      },
    });

    return plainOtp; // caller hands this to the mail service — never logged, never stored raw
  }

  async verify(
    userId: string,
    purpose: OtpPurpose,
    submittedOtp: string,
  ): Promise<void> {
    const otp = await this.prisma.otp.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new BadRequestException('No active verification code found');
    }

    if (otp.expiresAt < new Date()) {
      throw new BadRequestException('Verification code has expired');
    }

    if (otp.attempts >= otp.maxAttempts) {
      throw new BadRequestException(
        'Too many incorrect attempts. Request a new code.',
      );
    }

    const isValid = await bcrypt.compare(submittedOtp, otp.otpHash);

    if (!isValid) {
      await this.prisma.otp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Incorrect verification code');
    }

    await this.prisma.otp.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
  }

  private generateNumericCode(length: number): string {
    const min = 10 ** (length - 1);
    const max = 10 ** length - 1;
    return randomInt(min, max + 1).toString();
  }
}
