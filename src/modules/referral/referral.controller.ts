import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/guards/session-auth.guard';
import { ReferralService } from './referral.service';
import {
  ValidateReferralCodeDto,
  CommissionHistoryQueryDto,
} from './dto/referral.dto';

/**
 * Spec §26: user-facing referral endpoints. Identity is always derived
 * from the session, never from the URL (spec §23 — IDOR protection).
 */
@Controller('referral')
export class ReferralController {
  constructor(private readonly referral: ReferralService) {}

  /**
   * Spec §4 + §22: validate a referral code during registration.
   * Returns a generic boolean so the public form cannot enumerate
   * codes. Rate-limited.
   */
  @Post('validate')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async validate(@Body() body: ValidateReferralCodeDto) {
    return this.referral.validateReferralCode(body.code);
  }

  /**
   * Spec §26: returns the caller's eligibility (can refer or not, why
   * not, the current code, the current code status).
   * Higher throttle since users may refresh the rewards page.
   */
  @Get('eligibility')
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async eligibility(@CurrentUser() user: AuthUser) {
    return this.referral.getMyEligibility(user.id);
  }

  @Get('code')
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getMyCode(@CurrentUser() user: AuthUser) {
    return this.referral.getMyCode(user.id);
  }

  @Get('stats')
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getMyStats(@CurrentUser() user: AuthUser) {
    return this.referral.getMyStats(user.id);
  }

  /**
   * Spec §25 + §26: backend caps the tree at L5 for normal users.
   * ADMIN has a separate endpoint under /admin.
   */
  @Get('tree')
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getMyTree(@CurrentUser() user: AuthUser) {
    return this.referral.getMyTree(user.id);
  }

  @Get('commission-history')
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getCommissionHistory(
    @CurrentUser() user: AuthUser,
    @Query() q: CommissionHistoryQueryDto,
  ) {
    return this.referral.getMyCommissionHistory(
      user.id,
      q.page ?? 1,
      q.pageSize ?? 20,
    );
  }

  @Get('commission-summary')
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getCommissionSummary(@CurrentUser() user: AuthUser) {
    return this.referral.getMyCommissionSummary(user.id);
  }
}
