import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { CsrfService, CSRF_COOKIE } from '../csrf/csrf.service';
import { SESSION_COOKIE } from '../../modules/auth/guards/session-auth.guard';

export const SKIP_CSRF_KEY = 'skipCsrf';

/**
 * Endpoints that must be reachable before a session exists (login,
 * register, forgot/reset password) skip the token check; the Origin check
 * still protects them.
 */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

/**
 * Global CSRF defense (registered as APP_GUARD, so it runs on EVERY route
 * before controller-level guards).
 *
 * State-changing requests (POST/PUT/PATCH/DELETE) are protected by two
 * layered, independent checks:
 *
 * 1. Origin check — a browser always sends the `Origin` header on cross-site
 *    POST-like requests (form submissions, fetch). If it is present and not
 *    the configured frontend/same-origin, reject. Requests without an Origin
 *    header (native clients, curl, same-origin old browsers) pass — that is
 *    the documented trade-off, covered by SameSite=Lax + the token check.
 *
 * 2. Token check — authenticated state-changing requests must also carry a
 *    valid X-CSRF-Token matching the signed csrf_token cookie.
 *
 * Non-mutating reads (GET/HEAD/OPTIONS) are never blocked, and a missing
 * csrf_token cookie is silently issued on reads so the next mutation is
 * already armed.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigins: string[];

  constructor(
    private readonly csrfService: CsrfService,
    config: ConfigService,
    private readonly reflector: Reflector,
  ) {
    const frontendUrl = config.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
    this.allowedOrigins = [frontendUrl.replace(/\/$/, '')];
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const method = request.method.toUpperCase();

    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      this.ensureCookie(request, response);
      return true;
    }

    if (this.isSkipped(context)) {
      this.assertOrigin(request);
      return true;
    }

    this.assertOrigin(request);

    const hasSession = Boolean(
      (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE],
    );

    if (hasSession) {
      const headerToken = request.headers['x-csrf-token'] as string | undefined;
      const cookieValue = (
        request.cookies as Record<string, string> | undefined
      )?.[CSRF_COOKIE];
      if (!this.csrfService.verify(headerToken, cookieValue)) {
        throw new ForbiddenException('CSRF token missing or invalid');
      }
    }

    return true;
  }

  private getOrigin(request: Request): string | undefined {
    const origin = request.headers.origin;
    return typeof origin === 'string' && origin.length > 0 ? origin : undefined;
  }

  private assertOrigin(request: Request): void {
    const origin = this.getOrigin(request);
    if (origin && !this.allowedOrigins.includes(origin)) {
      throw new ForbiddenException('Cross-origin request rejected');
    }
  }

  private isSkipped(context: ExecutionContext): boolean {
    return !!this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  }

  private ensureCookie(request: Request, response: Response): void {
    if (
      (request.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE]
    ) {
      return;
    }

    const { cookieValue } = this.csrfService.issue();
    response.cookie(CSRF_COOKIE, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }
}
