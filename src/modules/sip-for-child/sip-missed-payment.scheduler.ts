import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SIPForChildService } from './sip-for-child.service';

const TICK_MS = 60 * 60 * 1000; // hourly

/**
 * Checks for missed SIP For Child premiums. On boot (after a short settle
 * delay) and then every hour, it finds VERIFIED applications whose
 * nextPaymentDue is in the past and marks each overdue month as missed.
 * At 4 consecutive misses the application is auto-rejected and refunded.
 */
@Injectable()
export class SIPMissedPaymentScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SIPMissedPaymentScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private initialTimer?: ReturnType<typeof setTimeout>;
  private isRunning = false;

  constructor(
    private readonly sipForChildService: SIPForChildService,
  ) {}

  onModuleInit() {
    this.initialTimer = setTimeout(() => void this.tick(), 20_000);
    this.initialTimer.unref?.();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    this.logger.log('SIP missed-payment scheduler started (hourly)');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
  }

  private async tick() {
    if (this.isRunning) {
      this.logger.warn('Missed-payment tick skipped — previous run still in progress');
      return;
    }

    this.isRunning = true;
    try {
      const result = await this.sipForChildService.processMissedPayments();
      if (result.missed > 0 || result.rejected > 0) {
        this.logger.log(
          `Missed-payment run: checked=${result.checked} missed=${result.missed} rejected=${result.rejected}`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Scheduled missed-payment run failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRunning = false;
    }
  }
}
