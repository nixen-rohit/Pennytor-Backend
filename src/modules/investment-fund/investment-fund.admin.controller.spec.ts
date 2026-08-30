import { Test, TestingModule } from '@nestjs/testing';
import { InvestmentFundAdminController } from './investment-fund.admin.controller';
import { InvestmentFundService } from './investment-fund.service';

describe('InvestmentFundAdminController', () => {
  let controller: InvestmentFundAdminController;
  let service: Record<string, any>;

  beforeEach(async () => {
    service = {
      adminList: jest.fn(),
      adminDetail: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
      processRoiPayouts: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvestmentFundAdminController],
      providers: [
        { provide: InvestmentFundService, useValue: service },
      ],
    })
      .overrideGuard(require('../../guards/roles.guard').RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../auth/guards/session-auth.guard').SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(InvestmentFundAdminController);
  });

  describe('list', () => {
    it('should call service with query params', async () => {
      const query = { page: 1, pageSize: 20, status: 'PENDING', search: 'test' } as any;
      await controller.list(query);
      expect(service.adminList).toHaveBeenCalledWith(query);
    });
  });

  describe('detail', () => {
    it('should call service with id', async () => {
      await controller.detail('app-1');
      expect(service.adminDetail).toHaveBeenCalledWith('app-1');
    });
  });

  describe('approve', () => {
    it('should call service with id and admin id', async () => {
      const admin = { id: 'admin-1' } as any;
      await controller.approve('app-1', admin);
      expect(service.approve).toHaveBeenCalledWith('app-1', 'admin-1');
    });
  });

  describe('reject', () => {
    it('should call service with id, admin id, and note', async () => {
      const admin = { id: 'admin-1' } as any;
      const dto = { note: 'Invalid KYC documents' } as any;
      await controller.reject('app-1', admin, dto);
      expect(service.reject).toHaveBeenCalledWith('app-1', 'admin-1', 'Invalid KYC documents');
    });
  });

  describe('runRoi', () => {
    it('should call service.processRoiPayouts', async () => {
      await controller.runRoi();
      expect(service.processRoiPayouts).toHaveBeenCalled();
    });
  });
});
