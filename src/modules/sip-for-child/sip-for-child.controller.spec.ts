import { Test, TestingModule } from '@nestjs/testing';
import { SIPForChildController } from './sip-for-child.controller';
import { SIPForChildService } from './sip-for-child.service';
import { SIPPlanId } from '@prisma/client';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';

describe('SIPForChildController', () => {
  let controller: SIPForChildController;
  let service: Record<string, any>;

  beforeEach(async () => {
    service = {
      getSchemes: jest.fn().mockReturnValue([]),
      verifyPasswordAndSendOtp: jest.fn(),
      createApplication: jest.fn(),
      payPremium: jest.fn(),
      myApplications: jest.fn(),
      myReports: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SIPForChildController],
      providers: [{ provide: SIPForChildService, useValue: service }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(SIPForChildController);
  });

  describe('getSchemes', () => {
    it('should call service.getSchemes', () => {
      controller.getSchemes();
      expect(service.getSchemes).toHaveBeenCalled();
    });
  });

  describe('verifyPassword', () => {
    it('should call service with user id, password, and scheme', async () => {
      const user = { id: 'user-1' } as any;
      const dto = { password: 'Test1234', scheme: 'PLAN_5000' as SIPPlanId };
      await controller.verifyPassword(user, dto);
      expect(service.verifyPasswordAndSendOtp).toHaveBeenCalledWith(
        'user-1',
        'Test1234',
        'PLAN_5000',
        undefined,
      );
    });
  });

  describe('createApplication', () => {
    it('should call service with user id and dto', async () => {
      const user = { id: 'user-1' } as any;
      const dto = {
        scheme: 'PLAN_5000' as SIPPlanId,
        password: 'Test1234',
        otp: '123456',
      };
      await controller.createApplication(user, dto);
      expect(service.createApplication).toHaveBeenCalledWith('user-1', dto);
    });
  });

  describe('payPremium', () => {
    it('should call service with user id, application id, and dto', async () => {
      const user = { id: 'user-1' } as any;
      const dto = { password: 'Test1234', otp: '123456' };
      await controller.payPremium(user, 'app-1', dto);
      expect(service.payPremium).toHaveBeenCalledWith('user-1', 'app-1', dto);
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
