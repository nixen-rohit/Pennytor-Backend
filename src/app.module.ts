import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './database/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { UsersModule } from './modules/users/users.module';
import { OtpModule } from './modules/otp/otp.module';
import { MailModule } from './modules/mail/mail.module';
import { AuthModule } from './modules/auth/auth.module';
import { SessionModule } from './modules/session/session.module';
import { KycModule } from './modules/kyc/kyc.module';
import { DepositsModule } from './modules/deposits/deposits.module';
import { WithdrawalsModule } from './modules/withdrawals/withdrawals.module';
import { FinanceModule } from './modules/finance/finance.module';
import { CsrfModule } from './modules/csrf/csrf.module';
import { CsrfGuard } from './modules/csrf/csrf.guard';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ContactUsModule } from './modules/contactus/contactus.module';
import { InvestmentFundModule } from './modules/investment-fund/investment-fund.module';
import { SIPForChildModule } from './modules/sip-for-child/sip-for-child.module';
import { FixedDepositModule } from './modules/fixed-deposit/fixed-deposit.module';
import { ReferralModule } from './modules/referral/referral.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ScheduleModule.forRoot(),
    AuditModule,
    SessionModule,
    CsrfModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get<number>('THROTTLE_TTL_SECONDS', 60) * 1000,
            limit: config.get<number>('THROTTLE_DEFAULT_LIMIT', 120),
          },
        ],
      }),
    }),
    UsersModule,
    OtpModule,
    MailModule,
    AuthModule,
    KycModule,
    DepositsModule,
    WithdrawalsModule,
    FinanceModule,
    ContactUsModule,
    InvestmentFundModule,
    SIPForChildModule,
    FixedDepositModule,
    ReferralModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Runs on every request BEFORE controller-level guards, so CSRF is
    // validated before session authentication spends a DB lookup.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
