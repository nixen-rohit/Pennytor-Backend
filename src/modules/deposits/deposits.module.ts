import { Module } from '@nestjs/common';
import { DepositController } from './deposit.controller';
import { DepositAdminController } from './deposit.admin.controller';
import { DepositService } from './deposit.service';
import { DepositRepository } from './deposit.repository';

@Module({
  controllers: [DepositController, DepositAdminController],
  providers: [DepositService, DepositRepository],
  exports: [DepositService],
})
export class DepositsModule {}