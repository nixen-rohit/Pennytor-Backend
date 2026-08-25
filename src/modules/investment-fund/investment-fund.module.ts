import { Module } from '@nestjs/common';
import { InvestmentFundController } from './investment-fund.controller';
import { InvestmentFundAdminController } from './investment-fund.admin.controller';
import { InvestmentFundService } from './investment-fund.service';
import { InvestmentFundRepository } from './investment-fund.repository';
import { InvestmentRoiScheduler } from './investment-roi.scheduler';
import { OtpModule } from '../otp/otp.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [OtpModule, MailModule],
  controllers: [InvestmentFundController, InvestmentFundAdminController],
  providers: [
    InvestmentFundService,
    InvestmentFundRepository,
    InvestmentRoiScheduler,
  ],
  exports: [InvestmentFundService],
})
export class InvestmentFundModule {}
