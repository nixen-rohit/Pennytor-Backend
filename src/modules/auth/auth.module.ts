import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { UsersModule } from '../users/users.module';
import { OtpModule } from '../otp/otp.module';
import { MailModule } from '../mail/mail.module';
import { SessionModule } from '../session/session.module';
import { CsrfModule } from '../csrf/csrf.module';

@Module({
  imports: [UsersModule, OtpModule, MailModule, SessionModule, CsrfModule],
  controllers: [AuthController],
  providers: [AuthService, SessionAuthGuard],
  exports: [SessionAuthGuard],
})
export class AuthModule {}
