import { Module } from '@nestjs/common';
import { SIPForChildController } from './sip-for-child.controller';
import { SIPForChildAdminController } from './sip-for-child.admin.controller';
import { SIPForChildService } from './sip-for-child.service';
import { SIPForChildRepository } from './sip-for-child.repository';
import { SIPMissedPaymentScheduler } from './sip-missed-payment.scheduler';
import { OtpModule } from '../otp/otp.module';
import { MailModule } from '../mail/mail.module';
import { ReferralModule } from '../referral/referral.module';
import { KycModule } from '../kyc/kyc.module';

@Module({
  imports: [OtpModule, MailModule, ReferralModule, KycModule],
  controllers: [SIPForChildController, SIPForChildAdminController],
  providers: [
    SIPForChildService,
    SIPForChildRepository,
    SIPMissedPaymentScheduler,
  ],
  exports: [SIPForChildService],
})
export class SIPForChildModule {}
