import { Module } from '@nestjs/common';
import { WithdrawalController } from './withdrawal.controller';
import { WithdrawalAdminController } from './withdrawal.admin.controller';
import { WithdrawalService } from './withdrawal.service';
import { WithdrawalRepository } from './withdrawal.repository';
import { OtpModule } from '../otp/otp.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [OtpModule, MailModule],
  controllers: [WithdrawalController, WithdrawalAdminController],
  providers: [WithdrawalService, WithdrawalRepository],
  exports: [WithdrawalService],
})
export class WithdrawalsModule {}
