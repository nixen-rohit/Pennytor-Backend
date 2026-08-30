import { Test, TestingModule } from '@nestjs/testing';
import { FDPayoutScheduler } from './fd-payout.scheduler';
import { FixedDepositService } from './fixed-deposit.service';
import { PrismaService } from '../../database/prisma.service';

describe('FDPayoutScheduler', () => {
  let scheduler: FDPayoutScheduler;
  let fdService: Record<string, any>;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    fdService = {
      processPayouts: jest.fn().mockResolvedValue({ total: 0, credited: 0, skipped: 0 }),
    };

    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
    };

    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FDPayoutScheduler,
        { provide: FixedDepositService, useValue: fdService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    scheduler = module.get(FDPayoutScheduler);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should start initial timer and interval', () => {
      scheduler.onModuleInit();

      expect(jest.getTimerCount()).toBe(2);
    });
  });

  describe('onModuleDestroy', () => {
    it('should clear timers', () => {
      scheduler.onModuleInit();
      scheduler.onModuleDestroy();

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('tick', () => {
    it('should call processPayouts after initial delay', async () => {
      scheduler.onModuleInit();

      jest.advanceTimersByTime(25_000);
      await Promise.resolve();
      await Promise.resolve();

      expect(fdService.processPayouts).toHaveBeenCalled();
    });

    it('should call processPayouts on interval', async () => {
      scheduler.onModuleInit();

      jest.advanceTimersByTime(60 * 60 * 1000);
      await Promise.resolve();
      await Promise.resolve();

      expect(fdService.processPayouts).toHaveBeenCalled();
    });

    it('should not run concurrent ticks', async () => {
      fdService.processPayouts.mockImplementation(() => {
        return new Promise((resolve) => setTimeout(() => resolve({ total: 0, credited: 0, skipped: 0 }), 5000));
      });

      scheduler.onModuleInit();

      // First tick
      jest.advanceTimersByTime(25_000);
      await Promise.resolve();
      await Promise.resolve();

      // Second tick before first completes
      jest.advanceTimersByTime(60 * 60 * 1000);
      await Promise.resolve();
      await Promise.resolve();

      // processPayouts should only be called once (concurrent skipped)
      expect(fdService.processPayouts).toHaveBeenCalledTimes(1);
    });

    it('should reset isRunning after error', async () => {
      fdService.processPayouts.mockRejectedValueOnce(new Error('DB error'));

      scheduler.onModuleInit();
      jest.advanceTimersByTime(25_000);
      await Promise.resolve();

      // Second tick should run because isRunning was reset
      fdService.processPayouts.mockResolvedValue({ total: 0, credited: 0, skipped: 0 });
      jest.advanceTimersByTime(60 * 60 * 1000);
      await Promise.resolve();

      expect(fdService.processPayouts).toHaveBeenCalledTimes(2);
    });
  });
});
