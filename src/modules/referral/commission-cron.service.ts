import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CommissionSchedulerService } from './commission-scheduler.service';

/**
 * Spec §16: a single monthly cron job. No L1/L2/L3/L4/L5 jobs — the
 * scheduler itself walks the tree (spec §16, "Do not create separate
 * L1, L2, L3, L4 and L5 jobs.").
 *
 * The cron schedule fires on the 2nd of every month at 02:30 server
 * time. Asia/Kolkata is the business timezone (spec §28) — the
 * scheduler itself computes the cycle month in IST.
 *
 * The job can also be triggered manually by an admin via
 * `POST /admin/commissions/run` (see ReferralAdminController).
 */
@Injectable()
export class CommissionCronService {
  private readonly logger = new Logger(CommissionCronService.name);

  constructor(private readonly scheduler: CommissionSchedulerService) {}

  /**
   * Run at 02:30 on the 2nd day of every month. Server-local time
   * is fine here because the cycle is computed in IST inside the
   * scheduler (spec §28).
   */
  @Cron('30 2 2 * *')
  async tick() {
    this.logger.log('Monthly commission cycle starting…');
    try {
      const result = await this.scheduler.runCycle();
      this.logger.log(
        `Monthly commission cycle complete: ${JSON.stringify(result)}`,
      );
    } catch (e) {
      this.logger.error('Commission cycle failed', (e as Error).stack);
    }
  }
}
