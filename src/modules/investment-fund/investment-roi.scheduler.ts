import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InvestmentFundService } from './investment-fund.service';

const TICK_MS = 60 * 60 * 1000; // hourly

/**
 * Auto-ROI sender. On boot (after a short settle delay) and then every hour
 * it asks the service to credit every fully elapsed ROI month for VERIFIED
 * applications. The credit itself is idempotent per month — lastRoiPaidAt
 * only advances inside the same transaction as the payout — so overlapping
 * or repeated ticks can never double-pay.
 */
@Injectable()
export class InvestmentRoiScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InvestmentRoiScheduler.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly investmentFundService: InvestmentFundService) {}

  onModuleInit() {
    // Small delay so the app finishes booting (DB pool, etc.) before the run.
    const initial = setTimeout(() => void this.tick(), 15_000);
    initial.unref?.();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    this.logger.log('Investment ROI scheduler started (hourly)');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      await this.investmentFundService.processRoiPayouts();
    } catch (error) {
      this.logger.error(
        'Scheduled ROI run failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
