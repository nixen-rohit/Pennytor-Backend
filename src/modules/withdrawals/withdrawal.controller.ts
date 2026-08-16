import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { WithdrawalService } from './withdrawal.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/guards/session-auth.guard';

/**
 * User-side withdrawal requests. CSRF is enforced globally; ownership is
 * derived from the session. The wallet is only debited on admin approval.
 */
@ApiTags('withdrawals')
@Controller('withdrawals')
@UseGuards(SessionAuthGuard)
@ApiCookieAuth()
export class WithdrawalController {
  constructor(private readonly withdrawalService: WithdrawalService) {}

  /** Emails a 6-digit OTP for the withdrawal submission. */
  @Post('otp')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send the withdrawal confirmation OTP' })
  sendOtp(@CurrentUser() user: AuthUser) {
    return this.withdrawalService.sendOtp(user.id);
  }

  @Get('mine')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Current wallet balance and the caller withdrawal requests',
  })
  myWithdrawals(@CurrentUser() user: AuthUser) {
    return this.withdrawalService.myWithdrawals(user.id);
  }

  /** Creates a PENDING withdrawal after OTP + password verification. */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Submit a withdrawal request' })
  createWithdrawal(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWithdrawalDto,
  ) {
    return this.withdrawalService.createWithdrawal(user.id, dto);
  }
}