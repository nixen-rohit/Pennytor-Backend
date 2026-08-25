import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { InvestmentFundService } from './investment-fund.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../../guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/guards/session-auth.guard';
import { ListInvestmentFundQueryDto } from './dto/list-investment-fund-query.dto';
import { RejectInvestmentFundDto } from './dto/reject-investment-fund.dto';

/**
 * Admin-only investment fund review surface. Applications arrive from the
 * user dashboard (apply wizard); approval here STARTS the ROI cycle
 * (verifiedAt) — the wallet was already debited at submission. Rejection
 * refunds the submitted amount atomically.
 */
@ApiTags('admin-investment-fund')
@Controller('admin/investment-fund')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiCookieAuth()
export class InvestmentFundAdminController {
  constructor(private readonly investmentFundService: InvestmentFundService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'List investment fund applications (filter by status/search)',
  })
  list(@Query() query: ListInvestmentFundQueryDto) {
    return this.investmentFundService.adminList(query);
  }

  /** Manual ROI run — also handy for testing before the hourly tick. */
  @Post('run-roi')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Trigger the auto-ROI credit job immediately' })
  async runRoi() {
    return this.investmentFundService.processRoiPayouts();
  }

  @Get(':id')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Investment fund application detail + cycle state' })
  detail(@Param('id') id: string) {
    return this.investmentFundService.adminDetail(id);
  }

  /** Approve — starts the lock-in / monthly ROI cycle; 409 if already processed. */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Approve an application and start its ROI cycle' })
  approve(@Param('id') id: string, @CurrentUser() admin: AuthUser) {
    return this.investmentFundService.approve(id, admin.id);
  }

  /** Reject with a reason — refunds the wallet; only pending can be rejected. */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Reject an application with a reason (refunds wallet)',
  })
  reject(
    @Param('id') id: string,
    @CurrentUser() admin: AuthUser,
    @Body() dto: RejectInvestmentFundDto,
  ) {
    return this.investmentFundService.reject(id, admin.id, dto.note);
  }
}
