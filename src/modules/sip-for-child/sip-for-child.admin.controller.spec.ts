import { Test, TestingModule } from '@nestjs/testing';
import { SIPForChildAdminController } from './sip-for-child.admin.controller';
import { SIPForChildService } from './sip-for-child.service';

describe('SIPForChildAdminController', () => {
  let controller: SIPForChildAdminController;
  let service: Record<string, any>;

  beforeEach(async () => {
    service = {
      adminList: jest.fn(),
      adminDetail: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SIPForChildAdminController],
      providers: [
        { provide: SIPForChildService, useValue: service },
      ],
    })
      .overrideGuard(require('../../guards/roles.guard').RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../auth/guards/session-auth.guard').SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(SIPForChildAdminController);
  });

  describe('listApplications', () => {
    it('should call service with parsed query params', async () => {
      const query = { page: '2', pageSize: '10', status: 'PENDING', search: 'test' } as any;
      await controller.listApplications(query);
      expect(service.adminList).toHaveBeenCalledWith({
        page: 2,
        pageSize: 10,
        status: 'PENDING',
        search: 'test',
      });
    });

    it('should default page to 1 and pageSize to 20', async () => {
      const query = {} as any;
      await controller.listApplications(query);
      expect(service.adminList).toHaveBeenCalledWith({
        page: 1,
        pageSize: 20,
        status: undefined,
        search: undefined,
      });
    });

    it('should clamp pageSize to max 100', async () => {
      const query = { pageSize: '200' } as any;
      await controller.listApplications(query);
      expect(service.adminList).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 100 }),
      );
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
      const dto = { note: 'Invalid documents' } as any;
      await controller.reject('app-1', dto, admin);
      expect(service.reject).toHaveBeenCalledWith('app-1', 'admin-1', 'Invalid documents');
    });
  });
});
