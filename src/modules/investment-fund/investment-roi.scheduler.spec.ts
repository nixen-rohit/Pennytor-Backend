import { Test, TestingModule } from '@nestjs/testing';
import { InvestmentRoiScheduler } from './investment-roi.scheduler';
import { InvestmentFundService } from './investment-fund.service';

describe('InvestmentRoiScheduler', () => {
  let scheduler: InvestmentRoiScheduler;
  let investService: Record<string, any>;

  beforeEach(async () => {
    investService = {
      processRoiPayouts: jest
        .fn()
        .mockResolvedValue({ applicationsProcessed: 0, monthsCredited: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvestmentRoiScheduler,
        { provide: InvestmentFundService, useValue: investService },
      ],
    }).compile();

    scheduler = module.get(InvestmentRoiScheduler);
  });

  afterEach(() => {
    scheduler.onModuleDestroy();
    jest.restoreAllMocks();
  });

  describe('onModuleInit', () => {
    it('should start initial timer and interval', () => {
      jest.useFakeTimers();
      scheduler.onModuleInit();
      expect(investService.processRoiPayouts).not.toHaveBeenCalled();

      jest.advanceTimersByTime(15_000);
      expect(investService.processRoiPayouts).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });
  });

  describe('onModuleDestroy', () => {
    it('should clear timers', () => {
      scheduler.onModuleInit();
      scheduler.onModuleDestroy();
    });
  });

  describe('tick', () => {
    it('should call processRoiPayouts', async () => {
      jest.useFakeTimers();
      scheduler.onModuleInit();

      jest.advanceTimersByTime(15_000);
      expect(investService.processRoiPayouts).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should log error on failure', async () => {
      investService.processRoiPayouts.mockRejectedValueOnce(
        new Error('DB error'),
      );

      jest.useFakeTimers();
      scheduler.onModuleInit();

      jest.advanceTimersByTime(15_000);
      await jest.advanceTimersByTimeAsync(0);

      // Should not throw — error is caught internally
      jest.useRealTimers();
    });
  });
});
