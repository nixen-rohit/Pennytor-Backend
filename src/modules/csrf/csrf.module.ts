import { Module } from '@nestjs/common';
import { CsrfService } from './csrf.service';
import { CsrfGuard } from './csrf.guard';

@Module({
  providers: [CsrfService, CsrfGuard],
  exports: [CsrfService, CsrfGuard],
})
export class CsrfModule {}
