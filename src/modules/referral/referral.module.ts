import { Module } from '@nestjs/common';
import { ReferralService } from './referral.service';
import { ReferralRepository } from './referral.repository';
import { ReferralCodeService } from './referral-code.service';
import { InvestmentEligibilityService } from './investment-eligibility.service';
import { CommissionConfigService } from './commission-config.service';
import { CommissionService } from './commission.service';
import { CommissionSchedulerService } from './commission-scheduler.service';
import { CommissionCronService } from './commission-cron.service';
import { SuperUserService } from './super-user.service';
import { ReferralController } from './referral.controller';
import { ReferralAdminController } from './referral-admin.controller';
import { AuditModule } from '../audit/audit.module';
import { KycModule } from '../kyc/kyc.module';

@Module({
  imports: [AuditModule, KycModule],
  controllers: [ReferralController, ReferralAdminController],
  providers: [
    ReferralRepository,
    ReferralCodeService,
    InvestmentEligibilityService,
    CommissionConfigService,
    ReferralService,
    CommissionService,
    CommissionSchedulerService,
    CommissionCronService,
    SuperUserService,
  ],
  exports: [
    ReferralService,
    ReferralCodeService,
    InvestmentEligibilityService,
    CommissionConfigService,
    CommissionService,
    CommissionSchedulerService,
    SuperUserService,
  ],
})
export class ReferralModule {}
