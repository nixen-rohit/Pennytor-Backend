import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { createHash, randomBytes } from 'crypto';

/**
 * Manages opaque refresh tokens (NOT JWTs) stored SHA-256-hashed in the DB.
 *
 * Design rationale (non-negotiable):
 * - Refresh tokens are opaque random strings, NOT JWTs, because they need
 *   instant revocability without a denylist. A JWT refresh token would require
 *   checking a denylist on every refresh, defeating the purpose.
 * - The raw token value is never stored — only its SHA-256 hash. A DB leak
 *   cannot yield valid tokens.
 * - Every refresh rotates the token (issue new, revoke old). The old token
 *   is linked to the new one via replacedByTokenId for theft detection.
 * - If a revoked token is replayed, that's a theft signal: revoke the entire
 *   chain and force logout-all on that user.
 *
 * Hashing note: We use SHA-256 instead of bcrypt for refresh tokens because:
 * 1. Bcrypt silently truncates input at 72 bytes — a 64-byte random hex token
 *    (128 chars) would have its entropy effectively halved.
 * 2. Refresh tokens are already high-entropy (256 bits of randomness), so
 *    bcrypt's slow-hash property (designed for low-entropy passwords) adds
 *    cost without meaningful security benefit.
 * 3. SHA-256 produces deterministic hashes, enabling direct DB lookup by hash
 *    instead of linear bcrypt.compare scans — a performance win at scale.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);
  private readonly expiryDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
  ) {
    this.expiryDays = this.config.get<number>('JWT_REFRESH_EXPIRY_DAYS', 30);
  }

  /**
   * Creates a new refresh token for the given user.
   *
   * Returns the raw token value (which the caller must deliver via HttpOnly
   * cookie). Only the SHA-256 hash is persisted.
   */
  async create(
    userId: string,
    ctx: { ipAddress?: string; userAgent?: string },
  ): Promise<string> {
    const rawToken = randomBytes(64).toString('hex');
    const tokenHash = RefreshTokenService.hashToken(rawToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.expiryDays);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return rawToken;
  }

  /**
   * Validates a raw refresh token, rotates it (issues a new one, revokes the
   * old), and returns the new raw token + user info.
   */
  async validateAndRotate(
    rawToken: string,
    ctx: { ipAddress?: string; userAgent?: string },
  ): Promise<{ rawToken: string; userId: string }> {
    const tokenHash = RefreshTokenService.hashToken(rawToken);

    // Direct lookup by hash — no linear scan needed with deterministic hashing
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (!token) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Reuse detection: if this token was already revoked, treat it as theft
    if (token.revokedAt) {
      await this.handleTheftDetection(token.userId, token.id, ctx);
      throw new UnauthorizedException('Session revoked — please log in again');
    }

    if (token.expiresAt <= new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Generate the new token
    const newRawToken = randomBytes(64).toString('hex');
    const newTokenHash = RefreshTokenService.hashToken(newRawToken);

    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + this.expiryDays);

    // Transaction: create the new token + revoke the old one atomically
    await this.prisma.$transaction(async (tx) => {
      const newToken = await tx.refreshToken.create({
        data: {
          userId: token.userId,
          tokenHash: newTokenHash,
          expiresAt: newExpiresAt,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      await tx.refreshToken.update({
        where: { id: token.id },
        data: {
          revokedAt: new Date(),
          replacedByTokenId: newToken.id,
        },
      });
    });

    await this.auditService.log({
      userId: token.userId,
      action: 'TOKEN_REFRESHED',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { rawToken: newRawToken, userId: token.userId };
  }

  /**
   * Theft signal: a revoked token was replayed. Revoke every active token for
   * this user and log the event.
   */
  private async handleTheftDetection(
    userId: string,
    tokenId: string,
    ctx: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    this.logger.warn(
      `Refresh token reuse detected for user ${userId} — revoking all sessions`,
    );

    // TODO: When SessionService exists, also revoke Session rows here
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.auditService.log({
      userId,
      action: 'TOKEN_REUSE_DETECTED',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { revokedTokenId: tokenId },
    });
  }

  /**
   * Revokes a single refresh token (for logout).
   */
  async revoke(rawToken: string): Promise<void> {
    const tokenHash = RefreshTokenService.hashToken(rawToken);
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, revokedAt: true },
    });
    if (!token || token.revokedAt) return;

    await this.prisma.refreshToken.update({
      where: { id: token.id },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Revokes every active refresh token for the given user (for "logout
   * everywhere" or password change/reset).
   */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * SHA-256 hash of a raw token. Deterministic — enables direct DB lookup
   * by hash without linear bcrypt.compare scans.
   */
  private static hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
