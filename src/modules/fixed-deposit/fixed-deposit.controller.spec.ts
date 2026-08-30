import { Test, TestingModule } from '@nestjs/testing';
import { FixedDepositController } from './fixed-deposit.controller';
import { FixedDepositService } from './fixed-deposit.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';

describe('FixedDepositController', () => {
  let controller: FixedDepositController;
  let service: Record<string, any>;

  const mockUser = { id: 'user-1', email: 'test@test.com', firstName: 'Test', lastName: 'User' };

  beforeEach(async () => {
    service = {
      getSchemes: jest.fn().mockReturnValue([]),
      verifyPasswordAndSendOtp: jest.fn(),
      createApplication: jest.fn(),
      myApplications: jest.fn(),
      myReports: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FixedDepositController],
      providers: [{ provide: FixedDepositService, useValue: service }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(FixedDepositController);
  });

  describe('getSchemes', () => {
    it('should return schemes', () => {
      controller.getSchemes();
      expect(service.getSchemes).toHaveBeenCalled();
    });
  });

  describe('verifyPassword', () => {
    it('should call service with user id, password, and planId', () => {
      service.verifyPasswordAndSendOtp.mockResolvedValue({ message: 'OTP sent' });

      controller.verifyPassword(mockUser as any, { password: 'Test1234', planId: 'FD_25000' as any });

      expect(service.verifyPasswordAndSendOtp).toHaveBeenCalledWith('user-1', 'Test1234', 'FD_25000');
    });
  });

  describe('createApplication', () => {
    it('should call service with user id, planId, password, and otp', () => {
      const dto = { planId: 'FD_25000' as any, password: 'Test1234', otp: '123456' };
      service.createApplication.mockResolvedValue({ id: 'app-1' });

      controller.createApplication(mockUser as any, dto);

      expect(service.createApplication).toHaveBeenCalledWith('user-1', 'FD_25000', 'Test1234', '123456');
    });
  });

  describe('myApplications', () => {
    it('should return user applications', async () => {
      service.myApplications.mockResolvedValue([{ id: 'app-1' }]);

      const result = await controller.myApplications(mockUser as any);

      expect(result).toEqual([{ id: 'app-1' }]);
      expect(service.myApplications).toHaveBeenCalledWith('user-1');
    });
  });

  describe('myReports', () => {
    it('should return user reports', async () => {
      service.myReports.mockResolvedValue({ items: [], total: 0 });

      const result = await controller.myReports(mockUser as any);

      expect(result).toEqual({ items: [], total: 0 });
      expect(service.myReports).toHaveBeenCalledWith('user-1');
    });
  });
});
