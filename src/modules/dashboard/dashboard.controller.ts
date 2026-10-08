import { Controller, Get, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/guards/session-auth.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  summary(@CurrentUser() user: AuthUser) {
    return this.dashboard.getSummary(user.id);
  }
}
