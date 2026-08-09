import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from '../../modules/auth/guards/session-auth.guard';

/**
 * Usage: `@CurrentUser() user: AuthUser` inside a route guarded by
 * SessionAuthGuard. Centralizes IDOR checks: resource lookups should be
 * scoped to `user.id`, never to a client-supplied id alone.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<Request & { user: AuthUser }>();
    return request.user;
  },
);