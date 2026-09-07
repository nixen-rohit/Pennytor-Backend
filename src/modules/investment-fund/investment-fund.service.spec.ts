import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
  HttpException,
  ForbiddenException,
} from '@nestjs/common';
import { InvestmentFundService } from './investment-fund.service';
import { InvestmentFundRepository } from './investment-fund.repository';
import { OtpService } from '../otp/otp.service';
import { MailService } from '../mail/mail.service';
import { ReferralService } from '../referral/referral.service';
import { KycService } from '../kyc/kyc.service';
import { Prisma, InvestmentStatus } from '@prisma/client';
import { InvestmentScheme } from './investment-fund.types';

jest.mock('../../common/utils/password.util', () => ({
  verifyPassword: jest.fn(),
}));

import { verifyPassword } from '../../common/utils/password.util';

describe('InvestmentFundService', () => {
  let service: InvestmentFundService;
  let repo: Record<string, any>;
  let otpService: Record<string, any>;
  let mailService: Record<string, any>;
  let kycService: Record<string, any>;

  const mockVerifyPassword = verifyPassword as jest.MockedFunction<
    typeof verifyPassword
  >;

  beforeEach(async () => {
    repo = {
      getSchemes: jest.fn().mockReturnValue([]),
      getUserWithPasswordHash: jest.fn(),
      createWithWalletDebit: jest.fn(),
      listMine: jest.fn(),
      roiTotalsForUser: jest.fn().mockResolvedValue({}),
      payoutHistory: jest.fn().mockResolvedValue([]),
      list: jest.fn(),
      findById: jest.fn(),
      findByIdPlain: jest.fn(),
      approveAndStartCycle: jest.fn(),
      rejectAndRefund: jest.fn(),
      findDueForRoi: jest.fn(),
      payRoi: jest.fn(),
      totalRoiPaid: jest.fn().mockResolvedValue(new Prisma.Decimal(0)),
    };

    otpService = {
      generate: jest.fn().mockResolvedValue('123456'),
      verify: jest.fn(),
    };

    mailService = {
      sendInvestmentFundOtpEmail: jest.fn(),
      sendInvestmentFundApprovedEmail: jest.fn(),
      sendWithdrawalOtpEmail: jest.fn(),
    };

    kycService = {
      assertKycVerified: jest.fn().mockResolvedValue(undefined),
      getKycStatus: jest.fn().mockResolvedValue('VERIFIED'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvestmentFundService,
        { provide: InvestmentFundRepository, useValue: repo },
        { provide: OtpService, useValue: otpService },
        { provide: MailService, useValue: mailService },
        {
          provide: ReferralService,
          useValue: {
            onInvestmentVerified: jest.fn().mockResolvedValue(undefined),
            onInvestmentDeactivated: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: KycService, useValue: kycService },
      ],
    }).compile();

    service = module.get(InvestmentFundService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSchemes', () => {
    it('should return 5 schemes', async () => {
      const schemes = await service.getSchemes();
      expect(schemes).toHaveLength(5);
    });

    it('should include scheme A with correct values', async () => {
      const schemes = await service.getSchemes();
      const a = schemes.find((s) => s.scheme === InvestmentScheme.A);
      expect(a).toBeDefined();
      expect(a!.minAmount).toBe(500000);
      expect(a!.maxAmount).toBe(2500000);
      expect(a!.roi).toBe(3);
    });

    it('should include scheme E with correct values', async () => {
      const schemes = await service.getSchemes();
      const e = schemes.find((s) => s.scheme === InvestmentScheme.E);
      expect(e).toBeDefined();
      expect(e!.minAmount).toBe(50000000);
      expect(e!.maxAmount).toBe(999999999);
      expect(e!.roi).toBe(5);
    });
  });

  describe('verifyPasswordAndSendOtp', () => {
    const userId = 'user-1';
    const password = 'Test1234';

    it('should send OTP on success', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: true } as any);

      const result = await service.verifyPasswordAndSendOtp(
        userId,
        password,
        'A',
        '1000000',
      );
      expect(result).toEqual({ success: true });
      expect(otpService.generate).toHaveBeenCalled();
    });

    it('should throw NotFoundException if user not found', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue(null);
      await expect(
        service.verifyPasswordAndSendOtp(userId, password, 'A'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for wrong password', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: false } as any);

      await expect(
        service.verifyPasswordAndSendOtp(userId, password, 'A'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should block after 5 failed attempts', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: false } as any);

      for (let i = 0; i < 5; i++) {
        try {
          await service.verifyPasswordAndSendOtp(userId, password, 'A');
        } catch {}
      }

      await expect(
        service.verifyPasswordAndSendOtp(userId, password, 'A'),
      ).rejects.toThrow(HttpException);
    });

    it('should reset attempts after successful verification', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: false } as any);

      for (let i = 0; i < 4; i++) {
        try {
          await service.verifyPasswordAndSendOtp(userId, password, 'A');
        } catch {}
      }

      mockVerifyPassword.mockResolvedValue({ valid: true } as any);
      await service.verifyPasswordAndSendOtp(userId, password, 'A');

      mockVerifyPassword.mockResolvedValue({ valid: false } as any);
      try {
        await service.verifyPasswordAndSendOtp(userId, password, 'A');
      } catch (err: any) {
        expect(err.message).toContain('4 attempts remaining');
      }
    });
  });

  describe('createApplication', () => {
    const userId = 'user-1';
    const dto = {
      scheme: InvestmentScheme.A,
      amount: '1000000',
      password: 'Test1234',
      otp: '123456',
    };

    it('should create application with wallet debit', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: true } as any);
      repo.createWithWalletDebit.mockResolvedValue({
        id: 'app-1',
        status: 'PENDING',
      });

      const result = await service.createApplication(userId, dto);
      expect(result.id).toBe('app-1');
    });

    it('should throw if user not found', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue(null);
      await expect(service.createApplication(userId, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw for amount <= 0', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
      });
      await expect(
        service.createApplication(userId, { ...dto, amount: '0' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw for amount below scheme minimum', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: true } as any);

      await expect(
        service.createApplication(userId, { ...dto, amount: '100' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw for amount above scheme maximum', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: true } as any);

      await expect(
        service.createApplication(userId, { ...dto, amount: '999999999999' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw for invalid scheme', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: true } as any);

      await expect(
        service.createApplication(userId, { ...dto, scheme: 'INVALID' as any }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw for wrong password', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: false } as any);

      await expect(service.createApplication(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw if active application exists', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: true } as any);
      repo.createWithWalletDebit.mockRejectedValue(
        new Error('ACTIVE_APPLICATION_EXISTS'),
      );

      await expect(service.createApplication(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw if insufficient balance', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: true } as any);
      repo.createWithWalletDebit.mockRejectedValue(
        new Error('INSUFFICIENT_BALANCE'),
      );

      await expect(service.createApplication(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('myApplications', () => {
    it('should return enriched application list', async () => {
      repo.listMine.mockResolvedValue([
        {
          id: 'app-1',
          scheme: InvestmentScheme.A,
          amount: new Prisma.Decimal(1000000),
          status: InvestmentStatus.VERIFIED,
          verifiedAt: new Date('2026-01-01'),
          lastRoiPaidAt: new Date('2026-07-01'),
          submittedAt: new Date('2025-12-01'),
          createdAt: new Date('2025-12-01'),
          reviewNote: null,
        },
      ]);
      repo.roiTotalsForUser.mockResolvedValue({
        'app-1': new Prisma.Decimal(210000),
      });

      const result = await service.myApplications('user-1');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].planLabel).toBe('Plan A');
      expect(result.items[0].cycle).toBeDefined();
    });

    it('should return empty array for user with no applications', async () => {
      repo.listMine.mockResolvedValue([]);
      const result = await service.myApplications('user-1');
      expect(result.items).toHaveLength(0);
    });

    it('should set cycle to null for PENDING applications', async () => {
      repo.listMine.mockResolvedValue([
        {
          id: 'app-1',
          scheme: InvestmentScheme.A,
          amount: new Prisma.Decimal(1000000),
          status: InvestmentStatus.PENDING,
          verifiedAt: null,
          lastRoiPaidAt: null,
          submittedAt: new Date(),
          createdAt: new Date(),
          reviewNote: null,
        },
      ]);

      const result = await service.myApplications('user-1');
      expect(result.items[0].cycle).toBeNull();
    });
  });

  describe('myReports', () => {
    it('should merge investments, refunds, and ROI payouts', async () => {
      repo.listMine.mockResolvedValue([
        {
          id: 'app-1',
          scheme: InvestmentScheme.A,
          amount: new Prisma.Decimal(1000000),
          status: InvestmentStatus.VERIFIED,
          submittedAt: new Date('2026-01-01'),
          createdAt: new Date('2026-01-01'),
          reviewedAt: null,
        },
      ]);
      repo.payoutHistory.mockResolvedValue([
        {
          id: 'roi-1',
          amount: new Prisma.Decimal(30000),
          createdAt: new Date('2026-02-01'),
          application: { scheme: InvestmentScheme.A },
        },
      ]);

      const result = await service.myReports('user-1');
      expect(result.items.length).toBeGreaterThanOrEqual(2);
    });

    it('should include refund entry for rejected applications', async () => {
      repo.listMine.mockResolvedValue([
        {
          id: 'app-1',
          scheme: InvestmentScheme.A,
          amount: new Prisma.Decimal(1000000),
          status: InvestmentStatus.REJECTED,
          submittedAt: new Date('2026-01-01'),
          createdAt: new Date('2026-01-01'),
          reviewedAt: new Date('2026-01-05'),
        },
      ]);
      repo.payoutHistory.mockResolvedValue([]);

      const result = await service.myReports('user-1');
      const refund = result.items.find((e: any) => e.kind === 'REFUND');
      expect(refund).toBeDefined();
      expect(refund!.direction).toBe('CREDIT');
    });
  });

  describe('adminList', () => {
    it('should return paginated admin list', async () => {
      repo.list.mockResolvedValue({
        items: [
          {
            id: 'app-1',
            user: {
              firstName: 'Test',
              lastName: 'User',
              email: 'test@test.com',
              clientId: 'C001',
              kycApplication: null,
            },
            scheme: InvestmentScheme.A,
            amount: new Prisma.Decimal(1000000),
            status: InvestmentStatus.PENDING,
            submittedAt: new Date(),
            createdAt: new Date(),
          },
        ],
        total: 1,
      });

      const result = await service.adminList({ page: 1, pageSize: 20 });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('adminDetail', () => {
    it('should return application detail with cycle state', async () => {
      repo.findById.mockResolvedValue({
        id: 'app-1',
        scheme: InvestmentScheme.A,
        amount: new Prisma.Decimal(1000000),
        status: InvestmentStatus.VERIFIED,
        verifiedAt: new Date('2026-01-01'),
        lastRoiPaidAt: new Date('2026-07-01'),
        submittedAt: new Date('2025-12-01'),
        createdAt: new Date('2025-12-01'),
        reviewNote: null,
        reviewedAt: null,
        user: {
          firstName: 'Test',
          lastName: 'User',
          email: 'test@test.com',
          clientId: 'C001',
          kycApplication: null,
        },
      });
      repo.totalRoiPaid.mockResolvedValue(new Prisma.Decimal(210000));

      const result = await service.adminDetail('app-1');
      expect(result.id).toBe('app-1');
      expect(result.cycle).toBeDefined();
    });

    it('should throw if application not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.adminDetail('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('approve', () => {
    it('should approve application', async () => {
      repo.findById.mockResolvedValue({
        id: 'app-1',
        scheme: InvestmentScheme.A,
        user: { email: 'test@test.com', firstName: 'Test' },
      });
      repo.approveAndStartCycle.mockResolvedValue({
        conflicted: false,
        application: {
          id: 'app-1',
          verifiedAt: new Date(),
          user: { email: 'test@test.com', firstName: 'Test' },
        },
      });

      const result = await service.approve('app-1', 'admin-1');
      expect(result.status).toBe(InvestmentStatus.VERIFIED);
    });

    it('should throw if application not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.approve('nonexistent', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException if already processed', async () => {
      repo.findById.mockResolvedValue({
        id: 'app-1',
        scheme: InvestmentScheme.A,
        user: { email: 'test@test.com', firstName: 'Test' },
      });
      repo.approveAndStartCycle.mockResolvedValue({
        conflicted: true,
        application: null,
      });

      await expect(service.approve('app-1', 'admin-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('reject', () => {
    it('should reject application with reason', async () => {
      repo.findByIdPlain.mockResolvedValue({ id: 'app-1' });
      repo.rejectAndRefund.mockResolvedValue({ conflicted: false });

      const result = await service.reject('app-1', 'admin-1', 'Invalid KYC');
      expect(result.status).toBe(InvestmentStatus.REJECTED);
    });

    it('should throw if reason too short', async () => {
      await expect(service.reject('app-1', 'admin-1', 'ab')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw if application not found', async () => {
      repo.findByIdPlain.mockResolvedValue(null);
      await expect(
        service.reject('nonexistent', 'admin-1', 'Valid reason'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if already processed', async () => {
      repo.findByIdPlain.mockResolvedValue({ id: 'app-1' });
      repo.rejectAndRefund.mockResolvedValue({ conflicted: true });

      await expect(
        service.reject('app-1', 'admin-1', 'Valid reason'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('processRoiPayouts', () => {
    it('should credit due ROI periods', async () => {
      const now = new Date('2026-08-01');
      const verifiedAt = new Date('2026-01-01');
      const lastRoiPaidAt = new Date('2026-07-01');

      repo.findDueForRoi.mockResolvedValue([
        {
          id: 'app-1',
          scheme: InvestmentScheme.A,
          amount: new Prisma.Decimal(1000000),
          verifiedAt,
          lastRoiPaidAt,
        },
      ]);
      repo.payRoi.mockResolvedValue(1);

      const result = await service.processRoiPayouts(now);
      expect(result.applicationsProcessed).toBe(1);
      expect(result.monthsCredited).toBe(1);
    });

    it('should handle no due applications', async () => {
      repo.findDueForRoi.mockResolvedValue([]);
      const result = await service.processRoiPayouts();
      expect(result.applicationsProcessed).toBe(0);
      expect(result.monthsCredited).toBe(0);
    });

    it('should handle payRoi errors gracefully', async () => {
      repo.findDueForRoi.mockResolvedValue([
        {
          id: 'app-1',
          scheme: InvestmentScheme.A,
          amount: new Prisma.Decimal(1000000),
          verifiedAt: new Date('2026-01-01'),
          lastRoiPaidAt: new Date('2026-07-01'),
        },
      ]);
      repo.payRoi.mockRejectedValue(new Error('DB error'));

      const result = await service.processRoiPayouts(new Date('2026-08-01'));
      expect(result.applicationsProcessed).toBe(0);
    });

    it('should not credit if no months elapsed', async () => {
      const now = new Date('2026-07-15');
      const lastRoiPaidAt = new Date('2026-07-01');

      repo.findDueForRoi.mockResolvedValue([
        {
          id: 'app-1',
          scheme: InvestmentScheme.A,
          amount: new Prisma.Decimal(1000000),
          verifiedAt: new Date('2026-01-01'),
          lastRoiPaidAt,
        },
      ]);

      const result = await service.processRoiPayouts(now);
      expect(result.monthsCredited).toBe(0);
    });
  });
});
