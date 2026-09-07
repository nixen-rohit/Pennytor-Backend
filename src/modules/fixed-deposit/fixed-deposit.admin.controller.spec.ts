import { Test, TestingModule } from '@nestjs/testing';
import { FixedDepositAdminController } from './fixed-deposit.admin.controller';
import { FixedDepositService } from './fixed-deposit.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../../guards/roles.guard';

describe('FixedDepositAdminController', () => {
  let controller: FixedDepositAdminController;
  let service: Record<string, any>;

  const mockAdmin = {
    id: 'admin-1',
    email: 'admin@test.com',
    firstName: 'Admin',
    lastName: 'User',
  };

  beforeEach(async () => {
    service = {
      listApplications: jest.fn(),
      getApplicationDetail: jest.fn(),
      approveApplication: jest.fn(),
      rejectApplication: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FixedDepositAdminController],
      providers: [{ provide: FixedDepositService, useValue: service }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(FixedDepositAdminController);
  });

  describe('listApplications', () => {
    it('should call service with parsed query params', async () => {
      service.listApplications.mockResolvedValue({ items: [], total: 0 });

      await controller.listApplications({
        page: '1',
        pageSize: '10',
        status: 'PENDING',
        search: 'test',
      });

      expect(service.listApplications).toHaveBeenCalledWith({
        page: 1,
        pageSize: 10,
        status: 'PENDING',
        search: 'test',
      });
    });

    it('should default page to 1 and pageSize to 20', async () => {
      service.listApplications.mockResolvedValue({ items: [], total: 0 });

      await controller.listApplications({});

      expect(service.listApplications).toHaveBeenCalledWith({
        page: 1,
        pageSize: 20,
        status: undefined,
        search: undefined,
      });
    });

    it('should clamp pageSize to max 100', async () => {
      service.listApplications.mockResolvedValue({ items: [], total: 0 });

      await controller.listApplications({ pageSize: '200' });

      expect(service.listApplications).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 100 }),
      );
    });
  });

  describe('detail', () => {
    it('should return application detail', async () => {
      service.getApplicationDetail.mockResolvedValue({ id: 'app-1' });

      const result = await controller.detail('app-1');

      expect(result).toEqual({ id: 'app-1' });
      expect(service.getApplicationDetail).toHaveBeenCalledWith('app-1');
    });
  });

  describe('approve', () => {
    it('should approve application', async () => {
      service.approveApplication.mockResolvedValue({
        id: 'app-1',
        status: 'VERIFIED',
      });

      const result = await controller.approve('app-1', mockAdmin as any);

      expect(result).toEqual({ id: 'app-1', status: 'VERIFIED' });
      expect(service.approveApplication).toHaveBeenCalledWith(
        'app-1',
        'admin-1',
      );
    });
  });

  describe('reject', () => {
    it('should reject application with note', async () => {
      service.rejectApplication.mockResolvedValue({
        message: 'Application rejected',
      });

      const result = await controller.reject(
        'app-1',
        { note: 'Not interested' },
        mockAdmin as any,
      );

      expect(result).toEqual({ message: 'Application rejected' });
      expect(service.rejectApplication).toHaveBeenCalledWith(
        'app-1',
        'admin-1',
        'Not interested',
      );
    });

    it('should reject application with empty note', async () => {
      service.rejectApplication.mockResolvedValue({
        message: 'Application rejected',
      });

      const result = await controller.reject('app-1', {}, mockAdmin as any);

      expect(service.rejectApplication).toHaveBeenCalledWith(
        'app-1',
        'admin-1',
        '',
      );
    });
  });
});
