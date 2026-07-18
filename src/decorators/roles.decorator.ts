import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Usage: @Roles('ADMIN')  or  @Roles('ADMIN', 'USER')
 * Must be paired with RolesGuard (and, in front of it, whatever guard
 * populates request.user — e.g. a JwtAuthGuard once login exists).
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
