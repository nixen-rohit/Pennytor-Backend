import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SIPForChildService } from './sip-for-child.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/guards/session-auth.guard';
import {
  CreateSIPForChildApplicationDto,
  PayPremiumDto,
  VerifyPasswordDto,
} from './dto/sip-for-child.dto';

@ApiTags('sip-for-child')
@Controller('sip-for-child')
@UseGuards(SessionAuthGuard)
@ApiCookieAuth()
export class SIPForChildController {
  constructor(private readonly sipForChildService: SIPForChildService) {}

  @Get('schemes')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get all SIP for Child schemes' })
  getSchemes() {
    return this.sipForChildService.getSchemes();
  }

  @Post('verify-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify password and send OTP for SIP for Child application',
  })
  async verifyPassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyPasswordDto,
  ) {
    return this.sipForChildService.verifyPasswordAndSendOtp(
      user.id,
      dto.password,
      dto.scheme,
      dto.amount,
    );
  }

  @Post('apply')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Submit SIP for Child application' })
  createApplication(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSIPForChildApplicationDto,
  ) {
    return this.sipForChildService.createApplication(user.id, dto);
  }

  @Post(':id/pay-premium')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Pay monthly SIP premium' })
  payPremium(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PayPremiumDto,
  ) {
    return this.sipForChildService.payPremium(user.id, id, dto);
  }

  @Get('mine')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get user SIP for Child applications' })
  myApplications(@CurrentUser() user: AuthUser) {
    return this.sipForChildService.myApplications(user.id);
  }

  @Get('reports')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'User SIP for Child report — premium payments, refunds',
  })
  myReports(@CurrentUser() user: AuthUser) {
    return this.sipForChildService.myReports(user.id);
  }
}
