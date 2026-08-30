import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FixedDepositService } from './fixed-deposit.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/guards/session-auth.guard';
import { VerifyFDPasswordDto, CreateFDApplicationDto } from './dto/fixed-deposit.dto';

@ApiTags('fixed-deposit')
@Controller('fixed-deposit')
@UseGuards(SessionAuthGuard)
@ApiCookieAuth()
export class FixedDepositController {
  constructor(private readonly fdService: FixedDepositService) {}

  @Get('schemes')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get all Fixed Deposit schemes' })
  getSchemes() {
    return this.fdService.getSchemes();
  }

  @Post('verify-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify password and send OTP for FD application' })
  verifyPassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyFDPasswordDto,
  ) {
    return this.fdService.verifyPasswordAndSendOtp(user.id, dto.password, dto.planId);
  }

  @Post('apply')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Submit Fixed Deposit application' })
  createApplication(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFDApplicationDto,
  ) {
    return this.fdService.createApplication(user.id, dto.planId, dto.password, dto.otp);
  }

  @Get('mine')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get user FD applications' })
  myApplications(@CurrentUser() user: AuthUser) {
    return this.fdService.myApplications(user.id);
  }

  @Get('reports')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'User FD reports' })
  myReports(@CurrentUser() user: AuthUser) {
    return this.fdService.myReports(user.id);
  }
}
