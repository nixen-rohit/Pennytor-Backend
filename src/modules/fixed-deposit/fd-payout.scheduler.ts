import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { FixedDepositService } from './fixed-deposit.service';

const TICK_MS = 60 * 60 * 1000; // hourly

@Injectable()
export class FDPayoutScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FDPayoutScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private initialTimer?: ReturnType<typeof setTimeout>;
  private isRunning = false;

  constructor(private readonly fdService: FixedDepositService) {}

  onModuleInit() {
    this.initialTimer = setTimeout(() => void this.tick(), 25_000);
    this.initialTimer.unref?.();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    this.logger.log('FD payout scheduler started (hourly)');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
  }

  private async tick() {
    if (this.isRunning) {
      this.logger.warn('FD payout tick skipped — previous run still in progress');
      return;
    }

    this.isRunning = true;
    try {
      const result = await this.fdService.processPayouts();
      if (result.credited > 0 || result.skipped > 0) {
        this.logger.log(
          `FD payout run: total=${result.total} credited=${result.credited} skipped=${result.skipped}`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Scheduled FD payout run failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRunning = false;
    }
  }
}
