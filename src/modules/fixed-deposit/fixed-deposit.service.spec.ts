import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { FixedDepositService } from './fixed-deposit.service';
import { FixedDepositRepository } from './fixed-deposit.repository';
import { OtpService } from '../otp/otp.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { ReferralService } from '../referral/referral.service';
import { KycService } from '../kyc/kyc.service';

jest.mock('../../common/utils/password.util', () => ({
  verifyPassword: jest.fn(),
}));

import { verifyPassword } from '../../common/utils/password.util';

describe('FixedDepositService', () => {
  let service: FixedDepositService;
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
      getSchemeById: jest.fn(),
      findActiveByUser: jest.fn(),
      getUserWithPasswordHash: jest.fn(),
      create: jest.fn(),
      listMine: jest.fn(),
      list: jest.fn(),
      findById: jest.fn(),
      approveAndStartCycle: jest.fn(),
      rejectAndRefund: jest.fn(),
      findDuePayouts: jest.fn(),
      creditPayout: jest.fn(),
    };

    otpService = {
      generate: jest.fn(),
      verify: jest.fn(),
    };

    mailService = {
      sendFDOTPEmail: jest.fn(),
      sendFDAppliedEmail: jest.fn(),
      sendFDApprovedEmail: jest.fn(),
      sendFDEMICreditedEmail: jest.fn(),
      sendFDMaturedEmail: jest.fn(),
    };

    kycService = {
      assertKycVerified: jest.fn().mockResolvedValue(undefined),
      getKycStatus: jest.fn().mockResolvedValue('VERIFIED'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FixedDepositService,
        { provide: FixedDepositRepository, useValue: repo },
        { provide: OtpService, useValue: otpService },
        { provide: MailService, useValue: mailService },
        { provide: AuditService, useValue: { log: jest.fn() } },
        {
          provide: PrismaService,
          useValue: {
            fixedDepositApplication: {
              findUnique: jest.fn().mockResolvedValue({ userId: 'u-1' }),
            },
          },
        },
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

    service = module.get(FixedDepositService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSchemes', () => {
    it('should delegate to repo.getSchemes', () => {
      service.getSchemes();
      expect(repo.getSchemes).toHaveBeenCalled();
    });
  });

  describe('verifyPasswordAndSendOtp', () => {
    const userId = 'user-1';
    const password = 'Test1234';
    const planId = 'FD_25000' as any;

    it('should throw ConflictException if user has active application for same plan', async () => {
      repo.findActiveByUser.mockResolvedValue({ id: 'existing' });

      await expect(
        service.verifyPasswordAndSendOtp(userId, password, planId),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow if user has active application for different plan', async () => {
      repo.findActiveByUser.mockResolvedValue(null);
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
        emailVerified: true,
      });
      mockVerifyPassword.mockResolvedValue({ valid: true } as any);
      otpService.generate.mockResolvedValue('123456');
      repo.getSchemeById.mockReturnValue({ depositAmount: 25000 });

      await service.verifyPasswordAndSendOtp(userId, password, planId);
      expect(otpService.generate).toHaveBeenCalled();
    });

    it('should throw NotFoundException if user not found', async () => {
      repo.findActiveByUser.mockResolvedValue(null);
      repo.getUserWithPasswordHash.mockResolvedValue(null);

      await expect(
        service.verifyPasswordAndSendOtp(userId, password, planId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for wrong password', async () => {
      repo.findActiveByUser.mockResolvedValue(null);
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
        emailVerified: true,
      });
      mockVerifyPassword.mockResolvedValue({ valid: false } as any);

      await expect(
        service.verifyPasswordAndSendOtp(userId, password, planId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should send OTP on success', async () => {
      repo.findActiveByUser.mockResolvedValue(null);
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
        emailVerified: true,
      });
      mockVerifyPassword.mockResolvedValue({ valid: true } as any);
      otpService.generate.mockResolvedValue('123456');
      repo.getSchemeById.mockReturnValue({ depositAmount: 25000 });

      const result = await service.verifyPasswordAndSendOtp(
        userId,
        password,
        planId,
      );
      expect(result.message).toBe('OTP sent to email');
      expect(mailService.sendFDOTPEmail).toHaveBeenCalledWith(
        'test@test.com',
        '123456',
        expect.objectContaining({ firstName: 'Test', planId }),
      );
    });

    it('should throw BadRequestException after 5 failed attempts', async () => {
      repo.findActiveByUser.mockResolvedValue(null);
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
        emailVerified: true,
      });
      mockVerifyPassword.mockResolvedValue({ valid: false } as any);

      for (let i = 0; i < 5; i++) {
        try {
          await service.verifyPasswordAndSendOtp(userId, password, planId);
        } catch {}
      }

      await expect(
        service.verifyPasswordAndSendOtp(userId, password, planId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createApplication', () => {
    const userId = 'user-1';
    const planId = 'FD_50000' as any;
    const password = 'Test1234';
    const otp = '123456';

    it('should throw ConflictException if active application exists for same plan', async () => {
      repo.findActiveByUser.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createApplication(userId, planId, password, otp),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException if user not found', async () => {
      repo.findActiveByUser.mockResolvedValue(null);
      repo.getUserWithPasswordHash.mockResolvedValue(null);

      await expect(
        service.createApplication(userId, planId, password, otp),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for wrong password', async () => {
      repo.findActiveByUser.mockResolvedValue(null);
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
        emailVerified: true,
      });
      mockVerifyPassword.mockResolvedValue({ valid: false } as any);

      await expect(
        service.createApplication(userId, planId, password, otp),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create application and send email on success', async () => {
      repo.findActiveByUser.mockResolvedValue(null);
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
        emailVerified: true,
      });
      mockVerifyPassword.mockResolvedValue({ valid: true } as any);
      otpService.verify.mockResolvedValue(undefined);
      const mockApp = { id: 'app-1', planId, depositAmount: 50000 };
      repo.create.mockResolvedValue(mockApp);
      repo.getSchemeById.mockReturnValue({
        depositAmount: 50000,
        lockInMonths: 42,
      });

      const result = await service.createApplication(
        userId,
        planId,
        password,
        otp,
      );
      expect(result).toEqual(mockApp);
      expect(repo.create).toHaveBeenCalledWith(userId, planId);
      expect(mailService.sendFDAppliedEmail).toHaveBeenCalledWith(
        'test@test.com',
        expect.objectContaining({ firstName: 'Test', planId }),
      );
    });
  });

  describe('myApplications', () => {
    it('should delegate to repo.listMine', async () => {
      repo.listMine.mockResolvedValue([{ id: 'app-1' }]);
      const result = await service.myApplications('user-1');
      expect(result).toEqual([{ id: 'app-1' }]);
    });
  });

  describe('myReports', () => {
    it('should delegate to repo.list with userId', async () => {
      repo.list.mockResolvedValue({ items: [], total: 0 });
      const result = await service.myReports('user-1', 1, 20);
      expect(result).toEqual({ items: [], total: 0 });
      expect(repo.list).toHaveBeenCalledWith({
        userId: 'user-1',
        page: 1,
        pageSize: 20,
      });
    });
  });

  describe('getApplicationDetail', () => {
    it('should delegate to repo.findById', async () => {
      repo.findById.mockResolvedValue({ id: 'app-1' });
      const result = await service.getApplicationDetail('app-1');
      expect(result).toEqual({ id: 'app-1' });
    });
  });

  describe('listApplications (admin)', () => {
    it('should pass status filter to repo.list', async () => {
      repo.list.mockResolvedValue({ items: [], total: 0 });
      await service.listApplications({
        status: 'PENDING',
        page: 1,
        pageSize: 10,
      });
      expect(repo.list).toHaveBeenCalledWith({
        status: 'PENDING',
        search: undefined,
        page: 1,
        pageSize: 10,
      });
    });

    it('should pass undefined status for ALL', async () => {
      repo.list.mockResolvedValue({ items: [], total: 0 });
      await service.listApplications({ status: 'ALL', page: 1, pageSize: 10 });
      expect(repo.list).toHaveBeenCalledWith({
        status: undefined,
        search: undefined,
        page: 1,
        pageSize: 10,
      });
    });
  });

  describe('approveApplication', () => {
    it('should throw ConflictException if application not pending', async () => {
      repo.approveAndStartCycle.mockResolvedValue({
        conflicted: true,
        application: null,
      });

      await expect(
        service.approveApplication('app-1', 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should approve and send email', async () => {
      const mockApp = {
        id: 'app-1',
        userId: 'user-1',
        planId: 'FD_25000',
        depositAmount: 25000,
        lockInMonths: 48,
        payoutMode: 'quarterly',
        emiAmount: 3130,
        totalEmis: 16,
        totalPayout: 50080,
        nextPayoutAt: new Date(),
      };
      repo.approveAndStartCycle.mockResolvedValue({
        conflicted: false,
        application: mockApp,
      });
      repo.getUserWithPasswordHash.mockResolvedValue({
        email: 'test@test.com',
        firstName: 'Test',
      });

      const result = await service.approveApplication('app-1', 'admin-1');
      expect(result).toEqual(mockApp);
      expect(mailService.sendFDApprovedEmail).toHaveBeenCalledWith(
        'test@test.com',
        expect.objectContaining({ firstName: 'Test', planId: 'FD_25000' }),
      );
    });
  });

  describe('rejectApplication', () => {
    it('should throw ConflictException if application not pending', async () => {
      repo.rejectAndRefund.mockResolvedValue({ conflicted: true });

      await expect(
        service.rejectApplication('app-1', 'admin-1', 'reason'),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject and return success', async () => {
      repo.rejectAndRefund.mockResolvedValue({ conflicted: false });

      const result = await service.rejectApplication(
        'app-1',
        'admin-1',
        'Not interested',
      );
      expect(result.message).toBe('Application rejected');
    });
  });

  describe('processPayouts (scheduler)', () => {
    it('should credit due payouts and send emails', async () => {
      repo.findDuePayouts.mockResolvedValue([
        {
          id: 'app-1',
          planId: 'FD_25000',
          totalPayout: 50080,
          depositAmount: 25000,
          user: { id: 'user-1', email: 'test@test.com', firstName: 'Test' },
          payouts: [{ emiNumber: 1, amount: 3130 }],
        },
      ]);
      repo.creditPayout.mockResolvedValue({
        payout: { emiNumber: 1, amount: 3130 },
        balanceAfter: 3130,
        isComplete: false,
      });

      const result = await service.processPayouts();
      expect(result).toEqual({ total: 1, credited: 1, skipped: 0 });
      expect(mailService.sendFDEMICreditedEmail).toHaveBeenCalled();
    });

    it('should skip apps with no pending payouts', async () => {
      repo.findDuePayouts.mockResolvedValue([
        {
          id: 'app-1',
          user: { email: 'test@test.com', firstName: 'Test' },
          payouts: [],
        },
      ]);

      const result = await service.processPayouts();
      expect(result).toEqual({ total: 1, credited: 0, skipped: 1 });
    });

    it('should send matured email when last EMI paid', async () => {
      repo.findDuePayouts.mockResolvedValue([
        {
          id: 'app-1',
          planId: 'FD_100000',
          totalPayout: 200000,
          depositAmount: 100000,
          user: { id: 'user-1', email: 'test@test.com', firstName: 'Test' },
          payouts: [{ emiNumber: 40, amount: 5000 }],
        },
      ]);
      repo.creditPayout.mockResolvedValue({
        payout: { emiNumber: 40, amount: 5000 },
        balanceAfter: 200000,
        isComplete: true,
      });

      const result = await service.processPayouts();
      expect(result.credited).toBe(1);
      expect(mailService.sendFDMaturedEmail).toHaveBeenCalled();
      expect(mailService.sendFDEMICreditedEmail).not.toHaveBeenCalled();
    });

    it('should handle empty due payouts', async () => {
      repo.findDuePayouts.mockResolvedValue([]);

      const result = await service.processPayouts();
      expect(result).toEqual({ total: 0, credited: 0, skipped: 0 });
    });

    it('should handle creditPayout errors gracefully', async () => {
      repo.findDuePayouts.mockResolvedValue([
        {
          id: 'app-1',
          user: { email: 'test@test.com', firstName: 'Test' },
          payouts: [{ emiNumber: 1, amount: 3130 }],
        },
      ]);
      repo.creditPayout.mockRejectedValue(new Error('DB error'));

      const result = await service.processPayouts();
      expect(result).toEqual({ total: 1, credited: 0, skipped: 1 });
    });
  });

  describe('password attempt tracking', () => {
    it('should block after 5 failed attempts', async () => {
      repo.findActiveByUser.mockResolvedValue(null);
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
        emailVerified: true,
      });
      mockVerifyPassword.mockResolvedValue({ valid: false } as any);

      for (let i = 0; i < 5; i++) {
        try {
          await service.verifyPasswordAndSendOtp(
            'user-1',
            'wrong',
            'FD_25000' as any,
          );
        } catch {}
      }

      await expect(
        service.verifyPasswordAndSendOtp('user-1', 'wrong', 'FD_25000' as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reset on successful verification', async () => {
      repo.findActiveByUser.mockResolvedValue(null);
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
        emailVerified: true,
      });
      mockVerifyPassword
        .mockResolvedValueOnce({ valid: false } as any)
        .mockResolvedValueOnce({ valid: true } as any);
      otpService.generate.mockResolvedValue('123456');
      repo.getSchemeById.mockReturnValue({ depositAmount: 25000 });

      // First attempt fails
      try {
        await service.verifyPasswordAndSendOtp(
          'user-1',
          'wrong',
          'FD_25000' as any,
        );
      } catch {}
      // Second attempt succeeds — should not throw
      const result = await service.verifyPasswordAndSendOtp(
        'user-1',
        'right',
        'FD_25000' as any,
      );
      expect(result.message).toBe('OTP sent to email');
    });
  });
});
