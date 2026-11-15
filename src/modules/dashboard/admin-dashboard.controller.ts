import { Controller, Get, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../../guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

/**
 * Admin dashboard home. Only returns the number of requests waiting for
 * review in each queue — no finance totals or per-row data.
 */
@Controller('admin/dashboard')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('pending-counts')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
    pendingCounts() {
    return this.dashboard.getAdminPendingCounts();
  }
}
