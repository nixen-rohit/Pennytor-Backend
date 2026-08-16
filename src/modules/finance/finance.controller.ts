import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { FinanceService } from './finance.service';
import { ListFinanceQueryDto } from './dto/list-finance-query.dto';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../../guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Admin finance report + dashboard aggregation. Deposit and withdrawal
 * requests keep their own admin APIs (list, review, approve, reject); this
 * module only merges both tables into the single report feed and computes
 * dashboard aggregates — all server-side.
 */
@ApiTags('admin-finance')
@Controller('admin/finance')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiCookieAuth()
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('reports')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Merged deposit + withdrawal report (date order, server-side filter/page/sort/search)',
  })
  listReports(@Query() query: ListFinanceQueryDto) {
    return this.financeService.listReports(query);
  }

  @Get('summary')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Aggregated finance counters for the dashboard (GROUP BY on DB)',
  })
  getSummary() {
    return this.financeService.summary();
  }
}