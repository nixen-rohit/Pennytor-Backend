import { Test, TestingModule } from '@nestjs/testing';
import { InvestmentFundController } from './investment-fund.controller';
import { InvestmentFundService } from './investment-fund.service';
import { InvestmentScheme } from './investment-fund.types';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';

describe('InvestmentFundController', () => {
  let controller: InvestmentFundController;
  let service: Record<string, any>;

  beforeEach(async () => {
    service = {
      getSchemes: jest.fn().mockReturnValue([]),
      verifyPasswordAndSendOtp: jest.fn(),
      createApplication: jest.fn(),
      myApplications: jest.fn(),
      myReports: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvestmentFundController],
      providers: [{ provide: InvestmentFundService, useValue: service }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(InvestmentFundController);
  });

  describe('getSchemes', () => {
    it('should call service.getSchemes', () => {
      controller.getSchemes();
      expect(service.getSchemes).toHaveBeenCalled();
    });
  });

  describe('verifyPassword', () => {
    it('should call service with user id, password, scheme, and amount', async () => {
      const user = { id: 'user-1' } as any;
      const dto = {
        password: 'Test1234',
        scheme: InvestmentScheme.A,
        amount: '1000000',
      };
      await controller.verifyPassword(user, dto);
      expect(service.verifyPasswordAndSendOtp).toHaveBeenCalledWith(
        'user-1',
        'Test1234',
        InvestmentScheme.A,
        '1000000',
      );
    });
  });

  describe('createApplication', () => {
    it('should call service with user id and dto', async () => {
      const user = { id: 'user-1' } as any;
      const dto = {
        scheme: InvestmentScheme.A,
        amount: '1000000',
        password: 'Test1234',
        otp: '123456',
      };
      await controller.createApplication(user, dto);
      expect(service.createApplication).toHaveBeenCalledWith('user-1', dto);
    });
  });

  describe('myApplications', () => {
    it('should call service with user id', async () => {
      const user = { id: 'user-1' } as any;
      await controller.myApplications(user);
      expect(service.myApplications).toHaveBeenCalledWith('user-1');
    });
  });

  describe('myReports', () => {
    it('should call service with user id', async () => {
      const user = { id: 'user-1' } as any;
      await controller.myReports(user);
      expect(service.myReports).toHaveBeenCalledWith('user-1');
    });
  });
});
