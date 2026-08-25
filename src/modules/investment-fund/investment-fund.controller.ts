import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InvestmentFundService } from './investment-fund.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/guards/session-auth.guard';
import {
  CreateInvestmentApplicationDto,
  VerifyPasswordDto,
} from './dto/investment-fund.dto';

@ApiTags('investment-fund')
@Controller('investment-fund')
@UseGuards(SessionAuthGuard)
@ApiCookieAuth()
export class InvestmentFundController {
  constructor(private readonly investmentFundService: InvestmentFundService) {}

  @Get('schemes')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get all investment fund schemes' })
  getSchemes() {
    return this.investmentFundService.getSchemes();
  }

  @Post('verify-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify password and send OTP for investment application',
  })
  async verifyPassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyPasswordDto,
  ) {
    return this.investmentFundService.verifyPasswordAndSendOtp(
      user.id,
      dto.password,
      dto.scheme,
      dto.amount,
    );
  }

  @Post('otp')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send OTP for investment application' })
  sendOtp(@CurrentUser() user: AuthUser) {
    return this.investmentFundService.sendOtp(user.id);
  }

  @Post('apply')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Submit investment fund application' })
  createApplication(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateInvestmentApplicationDto,
  ) {
    return this.investmentFundService.createApplication(user.id, dto);
  }

  @Get('mine')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get user investment applications' })
  myApplications(@CurrentUser() user: AuthUser) {
    return this.investmentFundService.myApplications(user.id);
  }

  @Get('reports')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'User investment fund report — debits into schemes, refunds and ROI credits',
  })
  myReports(@CurrentUser() user: AuthUser) {
    return this.investmentFundService.myReports(user.id);
  }
}
