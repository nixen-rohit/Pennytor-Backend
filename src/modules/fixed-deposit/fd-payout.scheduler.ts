import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { FixedDepositService } from './fixed-deposit.service';
import { PrismaService } from '../../database/prisma.service';

const TICK_MS = 60 * 60 * 1000; // hourly
const LOCK_KEY = 83001; // arbitrary unique int for pg_advisory_lock

@Injectable()
export class FDPayoutScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FDPayoutScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private initialTimer?: ReturnType<typeof setTimeout>;
  private isRunning = false;
  private hasLock = false;

  constructor(
    private readonly fdService: FixedDepositService,
    private readonly prisma: PrismaService,
  ) {}

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
    void this.releaseLock();
  }

  private async acquireLock(): Promise<boolean> {
    try {
      const result = await this.prisma.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(${LOCK_KEY}) as locked
      `;
      this.hasLock = result[0]?.locked ?? false;
      return this.hasLock;
    } catch {
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    if (!this.hasLock) return;
    try {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCK_KEY})`;
      this.hasLock = false;
    } catch {
      /* best effort */
    }
  }

  private async tick() {
    if (this.isRunning) {
      this.logger.warn(
        'FD payout tick skipped — previous run still in progress',
      );
      return;
    }

    // Distributed lock: only one instance processes payouts
    if (!this.hasLock) {
      const acquired = await this.acquireLock();
      if (!acquired) {
        this.logger.debug(
          'FD payout tick skipped — another instance holds the lock',
        );
        return;
      }
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
