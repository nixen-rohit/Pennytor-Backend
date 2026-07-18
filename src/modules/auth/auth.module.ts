import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from '../users/users.module';
import { OtpModule } from '../otp/otp.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [UsersModule, OtpModule, MailModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
