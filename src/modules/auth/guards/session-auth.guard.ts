import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { SessionService } from '../../session/session.service';
import { PrismaService } from '../../../database/prisma.service';
import { UserStatus } from '@prisma/client';

export const SESSION_COOKIE = 'sid';

export interface AuthUser {
  id: string;
  role: 'USER' | 'ADMIN';
  email: string;
  firstName: string;
  lastName: string;
  sessionId: string;
}

/**
 * The API's authentication boundary.
 *
 * Reads the `sid` HttpOnly cookie, resolves the session by SHA-256 hash,
 * and verifies, in order:
 *   1. session exists,
 *   2. session not revoked,
 *   3. session not expired,
 *   4. account not locked / suspended / deleted.
 *
 * Sliding renewal: a session past 50% of its lifetime is extended, so an
 * active user is never cut off mid-session while an idle one eventually
 * expires (absolute expiry still caps total lifetime).
 *
 * The session update on every request is skipped unless it is stale by
 * more than a minute, keeping the write load negligible.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly sessionService: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const rawToken = (request.cookies as Record<string, string> | undefined)?.[
      SESSION_COOKIE
    ];

    if (!rawToken) {
      throw new UnauthorizedException('Not signed in');
    }

    const session = await this.sessionService.validate(rawToken);
    if (!session) {
      throw new UnauthorizedException('Invalid session');
    }

    if (session.revokedAt) {
      throw new UnauthorizedException('Session revoked');
    }

    if (session.expiresAt <= new Date()) {
      await this.sessionService.revoke(rawToken);
      throw new UnauthorizedException('Session expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        role: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        lockedUntil: true,
      },
    });

    if (!user || user.status === UserStatus.DELETED) {
      throw new UnauthorizedException('Account no longer exists');
    }

    if (user.status === UserStatus.LOCKED || user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Account is not accessible');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account is temporarily locked');
    }

    await this.sessionService.renewIfNeeded(session.id, session.expiresAt);

    const now = Date.now();
    if (now - session.lastActiveAt.getTime() > 60_000) {
      await this.sessionService.touch(session.id);
    }

    (request as Request & { user: AuthUser }).user = {
      id: user.id,
      role: user.role,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      sessionId: session.id,
    };

    return true;
  }
}