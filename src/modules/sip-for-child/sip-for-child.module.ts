import { Module } from '@nestjs/common';
import { SIPForChildController } from './sip-for-child.controller';
import { SIPForChildAdminController } from './sip-for-child.admin.controller';
import { SIPForChildService } from './sip-for-child.service';
import { SIPForChildRepository } from './sip-for-child.repository';
import { OtpModule } from '../otp/otp.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [OtpModule, MailModule],
  controllers: [SIPForChildController, SIPForChildAdminController],
  providers: [SIPForChildService, SIPForChildRepository],
  exports: [SIPForChildService],
})
export class SIPForChildModule {}
