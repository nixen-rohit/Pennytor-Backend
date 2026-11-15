import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InvestmentFundService } from './investment-fund.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/guards/session-auth.guard';
import {
  CreateInvestmentApplicationDto,
  VerifyPasswordDto,
} from './dto/investment-fund.dto';

@Controller('investment-fund')
@UseGuards(SessionAuthGuard)
export class InvestmentFundController {
  constructor(private readonly investmentFundService: InvestmentFundService) {}

  @Get('schemes')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getSchemes() {
    return this.investmentFundService.getSchemes();
  }

  @Post('verify-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
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

  @Post('apply')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createApplication(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateInvestmentApplicationDto,
  ) {
    return this.investmentFundService.createApplication(user.id, dto);
  }

  @Get('mine')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  myApplications(@CurrentUser() user: AuthUser) {
    return this.investmentFundService.myApplications(user.id);
  }

  @Get('reports')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  myReports(@CurrentUser() user: AuthUser) {
    return this.investmentFundService.myReports(user.id);
  }
}
