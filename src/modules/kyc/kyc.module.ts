import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycAdminController } from './kyc.admin.controller';
import { KycService } from './kyc.service';
import { KycRepository } from './kyc.repository';
import { KycFileService } from './kyc.file.service';
import { EncryptionService } from '../../common/services/encryption.service';
import { OtpModule } from '../otp/otp.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [OtpModule, MailModule],
  controllers: [KycController, KycAdminController],
  providers: [KycService, KycRepository, KycFileService, EncryptionService],
  exports: [KycService, KycFileService],
})
export class KycModule {}
