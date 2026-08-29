import { Module } from '@nestjs/common';
import { FixedDepositController } from './fixed-deposit.controller';
import { FixedDepositAdminController } from './fixed-deposit.admin.controller';
import { FixedDepositService } from './fixed-deposit.service';
import { FixedDepositRepository } from './fixed-deposit.repository';
import { FDPayoutScheduler } from './fd-payout.scheduler';
import { OtpModule } from '../otp/otp.module';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [OtpModule, MailModule, PrismaModule],
  controllers: [FixedDepositController, FixedDepositAdminController],
  providers: [
    FixedDepositService,
    FixedDepositRepository,
    FDPayoutScheduler,
  ],
  exports: [FixedDepositService],
})
export class FixedDepositModule {}
