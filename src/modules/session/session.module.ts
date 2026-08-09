import { Global, Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { AuditModule } from '../audit/audit.module';

@Global()
@Module({
  imports: [AuditModule],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}