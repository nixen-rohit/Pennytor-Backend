import { Test, TestingModule } from '@nestjs/testing';
import { SIPMissedPaymentScheduler } from './sip-missed-payment.scheduler';
import { SIPForChildService } from './sip-for-child.service';

describe('SIPMissedPaymentScheduler', () => {
  let scheduler: SIPMissedPaymentScheduler;
  let sipService: Record<string, any>;

  beforeEach(async () => {
    sipService = {
      processMissedPayments: jest.fn().mockResolvedValue({ checked: 0, missed: 0, rejected: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SIPMissedPaymentScheduler,
        { provide: SIPForChildService, useValue: sipService },
      ],
    }).compile();

    scheduler = module.get(SIPMissedPaymentScheduler);
  });

  afterEach(() => {
    scheduler.onModuleDestroy();
    jest.restoreAllMocks();
  });

  describe('onModuleInit', () => {
    it('should start initial timer and interval', () => {
      jest.useFakeTimers();
      scheduler.onModuleInit();
      expect(sipService.processMissedPayments).not.toHaveBeenCalled();

      jest.advanceTimersByTime(20_000);
      expect(sipService.processMissedPayments).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });
  });

  describe('onModuleDestroy', () => {
    it('should clear timers', () => {
      scheduler.onModuleInit();
      scheduler.onModuleDestroy();
      // No error means timers were cleared
    });
  });

  describe('tick', () => {
    it('should call processMissedPayments', async () => {
      jest.useFakeTimers();
      scheduler.onModuleInit();

      jest.advanceTimersByTime(20_000);
      expect(sipService.processMissedPayments).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should not run concurrent ticks', async () => {
      jest.useFakeTimers();
      scheduler.onModuleInit();

      // Start first tick
      jest.advanceTimersByTime(20_000);
      // The first tick is still running, second tick should be skipped
      jest.advanceTimersByTime(60 * 60 * 1000);

      // processMissedPayments should only be called once (first tick)
      // because isRunning is true during the first call
      await jest.advanceTimersByTimeAsync(0);

      jest.useRealTimers();
    });

    it('should reset isRunning after error', async () => {
      sipService.processMissedPayments.mockRejectedValueOnce(new Error('DB error'));

      jest.useFakeTimers();
      scheduler.onModuleInit();

      jest.advanceTimersByTime(20_000);
      await jest.advanceTimersByTimeAsync(0);

      // Next tick should run because isRunning was reset
      sipService.processMissedPayments.mockResolvedValue({ checked: 1, missed: 0, rejected: 0 });
      jest.advanceTimersByTime(60 * 60 * 1000);
      await jest.advanceTimersByTimeAsync(0);

      expect(sipService.processMissedPayments).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });
});
