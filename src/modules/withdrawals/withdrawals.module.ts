import { Module } from '@nestjs/common';
import { WithdrawalController } from './withdrawal.controller';
import { WithdrawalAdminController } from './withdrawal.admin.controller';
import { WithdrawalService } from './withdrawal.service';
import { WithdrawalRepository } from './withdrawal.repository';
import { OtpModule } from '../otp/otp.module';
import { MailModule } from '../mail/mail.module';
import { KycModule } from '../kyc/kyc.module';

@Module({
  imports: [OtpModule, MailModule, KycModule],
  controllers: [WithdrawalController, WithdrawalAdminController],
  providers: [WithdrawalService, WithdrawalRepository],
  exports: [WithdrawalService],
})
export class WithdrawalsModule {}
