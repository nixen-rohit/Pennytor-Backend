import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { generateOpaqueToken, hashToken } from '../../common/utils/token.util';
import { AuditService } from '../audit/audit.service';

export interface SessionContext {
  ipAddress?: string;
  userAgent?: string;
  deviceLabel?: string;
}

const MAX_SESSIONS_PER_USER = 10;

/**
 * Server-side session manager.
 *
 * - Sessions use opaque 256-bit random IDs delivered via an HttpOnly
 *   cookie. The raw ID is NEVER stored; only its SHA-256 hash is.
 * - Session fixation is impossible by construction: the server generates
 *   every ID, a fresh one is issued at login, and the client can never
 *   influence it.
 * - `revokedAt` gives instant revocation; `expiresAt` gives absolute
 *   lifetime. The auth guard applies sliding renewal.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly ttlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
  ) {
    this.ttlDays = this.config.get<number>('SESSION_TTL_DAYS', 30);
  }

  get ttlMillis(): number {
    return this.ttlDays * 24 * 60 * 60 * 1000;
  }

  /** Creates a session and returns the raw ID to hand to the client. */
  async create(userId: string, ctx: SessionContext): Promise<string> {
    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);

    const expiresAt = new Date(Date.now() + this.ttlMillis);

    await this.prisma.$transaction(async (tx) => {
      await this.pruneOldSessions(tx);

      const activeCount = await tx.session.count({
        where: { userId, revokedAt: null },
      });

      if (activeCount >= MAX_SESSIONS_PER_USER) {
        const oldest = await tx.session.findFirst({
          where: { userId, revokedAt: null },
          orderBy: { lastActiveAt: 'asc' },
        });
        if (oldest) {
          await tx.session.update({
            where: { id: oldest.id },
            data: { revokedAt: new Date() },
          });
        }
      }

      await tx.session.create({
        data: {
          userId,
          tokenHash,
          expiresAt,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          deviceLabel: ctx.deviceLabel,
        },
      });
    });

    return rawToken;
  }

  /**
   * Validates a raw session ID. Returns the stored session or null when
   * missing/expired/revoked. Does NOT check the user's account status —
   * the guard does that.
   */
  async validate(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    return this.prisma.session.findUnique({
      where: { tokenHash },
    });
  }

  /** Sliding renewal: extends expiresAt when the session is past its midpoint. */
  async renewIfNeeded(sessionId: string, expiresAt: Date): Promise<void> {
    if (expiresAt.getTime() - Date.now() < this.ttlMillis / 2) {
      await this.prisma.session.update({
        where: { id: sessionId },
        data: { expiresAt: new Date(Date.now() + this.ttlMillis) },
      });
    }
  }

  /** Marks activity (guard calls this at most once per minute per session). */
  async touch(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { lastActiveAt: new Date() },
    });
  }

  /** Revokes a single session (logout of this device). */
  async revoke(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    await this.prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every active session (logout everywhere / password change). */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async listForUser(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastActiveAt: 'desc' },
      select: {
        id: true,
        deviceLabel: true,
        ipAddress: true,
        userAgent: true,
        lastActiveAt: true,
        createdAt: true,
        expiresAt: true,
      },
    });
  }

  async revokeById(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }

  /** Deletes long-expired / long-revoked rows to keep the table small. */
  private async pruneOldSessions(tx: Prisma.TransactionClient): Promise<void> {
    const cutoff = new Date(Date.now() - this.ttlMillis * 2);
    const deleted = await tx.session.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
      },
    });
    if (deleted.count > 0) {
      this.logger.log(`Pruned ${deleted.count} stale sessions`);
    }
  }
}
