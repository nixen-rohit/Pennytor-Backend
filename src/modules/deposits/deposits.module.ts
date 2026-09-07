import { Module } from '@nestjs/common';
import { DepositController } from './deposit.controller';
import { DepositAdminController } from './deposit.admin.controller';
import { DepositService } from './deposit.service';
import { DepositRepository } from './deposit.repository';
import { KycModule } from '../kyc/kyc.module';

@Module({
  imports: [KycModule],
  controllers: [DepositController, DepositAdminController],
  providers: [DepositService, DepositRepository],
  exports: [DepositService],
})
export class DepositsModule {}
