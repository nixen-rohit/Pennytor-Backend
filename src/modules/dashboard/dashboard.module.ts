import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DepositsModule } from '../deposits/deposits.module';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import { InvestmentFundModule } from '../investment-fund/investment-fund.module';
import { SIPForChildModule } from '../sip-for-child/sip-for-child.module';
import { FixedDepositModule } from '../fixed-deposit/fixed-deposit.module';
import { ReferralModule } from '../referral/referral.module';

@Module({
  imports: [
    DepositsModule,
    WithdrawalsModule,
    InvestmentFundModule,
    SIPForChildModule,
    FixedDepositModule,
    ReferralModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
