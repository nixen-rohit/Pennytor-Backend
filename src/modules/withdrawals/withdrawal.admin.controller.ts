import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { WithdrawalService } from './withdrawal.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../../guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/guards/session-auth.guard';
import { ListWithdrawalsQueryDto } from './dto/list-withdrawals-query.dto';
import { UpdateWithdrawalStatusDto } from './dto/update-withdrawal-status.dto';
import { RejectWithdrawalDto } from './dto/reject-withdrawal.dto';

/**
 * Admin-only withdrawal review surface. Every route is gated by
 * SessionAuthGuard + RolesGuard(@Roles(ADMIN)); the frontend's role check is
 * presentation-only. Approval debits the user's wallet exactly once.
 */
@ApiTags('admin-withdrawals')
@Controller('admin/withdrawals')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiCookieAuth()
export class WithdrawalAdminController {
  constructor(private readonly withdrawalService: WithdrawalService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'List withdrawal requests (filter by status/search)',
  })
  listWithdrawals(@Query() query: ListWithdrawalsQueryDto) {
    return this.withdrawalService.listWithdrawals(query);
  }

  @Get(':id')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Withdrawal request detail' })
  getWithdrawal(@Param('id') id: string) {
    return this.withdrawalService.getWithdrawalDetail(id);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Review decision: UNDER_REVIEW / VERIFIED / REJECTED',
  })
  updateStatus(
    @Param('id') id: string,
    @CurrentUser() admin: AuthUser,
    @Body() dto: UpdateWithdrawalStatusDto,
  ) {
    return this.withdrawalService.updateStatus(
      id,
      admin.id,
      dto.status,
      dto.note,
    );
  }

  /** Approve — atomic debit + ledger + audit; only pending can be approved (409 otherwise). */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Approve a withdrawal (debits wallet + ledger, audited)',
  })
  approve(@Param('id') id: string, @CurrentUser() admin: AuthUser) {
    return this.withdrawalService.approve(id, admin.id);
  }

  /** Reject with a reason — no money moves; only pending can be rejected (409 otherwise). */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reject a withdrawal with a reason (audited)' })
  reject(
    @Param('id') id: string,
    @CurrentUser() admin: AuthUser,
    @Body() dto: RejectWithdrawalDto,
  ) {
    return this.withdrawalService.reject(id, admin.id, dto.note);
  }
}
