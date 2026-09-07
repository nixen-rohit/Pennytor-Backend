import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { SIPForChildService } from './sip-for-child.service';
import { SIPForChildRepository } from './sip-for-child.repository';
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

describe('SIPForChildService', () => {
  let service: SIPForChildService;
  let repo: Record<string, any>;
  let otpService: Record<string, any>;
  let mailService: Record<string, any>;
  let kycService: Record<string, any>;

  const mockVerifyPassword = verifyPassword as jest.MockedFunction<
    typeof verifyPassword
  >;

  beforeEach(async () => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      listMine: jest.fn(),
      list: jest.fn(),
      getUserWithPasswordHash: jest.fn(),
      findActiveByUserAndScheme: jest.fn(),
      approveAndStartCycle: jest.fn(),
      rejectAndRefund: jest.fn(),
      payPremium: jest.fn(),
      premiumsForUser: jest.fn(),
      findApplicationsWithDuePremiums: jest.fn(),
      markMonthMissed: jest.fn(),
    };

    otpService = {
      generate: jest.fn().mockResolvedValue('123456'),
      verify: jest.fn(),
    };

    mailService = {
      sendSipForChildOtpEmail: jest.fn(),
      sendSipForChildPremiumPaidEmail: jest.fn(),
      sendSipForChildApprovedEmail: jest.fn(),
      sendSipForChildMissedPaymentEmail: jest.fn(),
      sendSipForChildAutoRejectedEmail: jest.fn(),
      sendWithdrawalOtpEmail: jest.fn(),
    };

    kycService = {
      assertKycVerified: jest.fn().mockResolvedValue(undefined),
      getKycStatus: jest.fn().mockResolvedValue('VERIFIED'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SIPForChildService,
        { provide: SIPForChildRepository, useValue: repo },
        { provide: OtpService, useValue: otpService },
        { provide: MailService, useValue: mailService },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: PrismaService, useValue: {} },
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

    service = module.get(SIPForChildService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSchemes', () => {
    it('should return 2 schemes', async () => {
      const schemes = await service.getSchemes();
      expect(schemes).toHaveLength(2);
    });

    it('should return PLAN_5000 with correct values', async () => {
      const schemes = await service.getSchemes();
      const plan = schemes.find((s) => s.id === 'PLAN_5000');
      expect(plan).toBeDefined();
      expect(plan!.monthlyInvestment).toBe(5000);
      expect(plan!.investmentYears).toBe(10);
      expect(plan!.annualReturn).toBe(22);
    });

    it('should return PLAN_2500 with correct values', async () => {
      const schemes = await service.getSchemes();
      const plan = schemes.find((s) => s.id === 'PLAN_2500');
      expect(plan).toBeDefined();
      expect(plan!.monthlyInvestment).toBe(2500);
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
        'PLAN_5000',
      );
      expect(result).toEqual({ success: true });
      expect(otpService.generate).toHaveBeenCalled();
      expect(mailService.sendSipForChildOtpEmail).toHaveBeenCalled();
    });

    it('should throw NotFoundException if user not found', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue(null);
      await expect(
        service.verifyPasswordAndSendOtp(userId, password, 'PLAN_5000'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for wrong password', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: false } as any);

      await expect(
        service.verifyPasswordAndSendOtp(userId, password, 'PLAN_5000'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should decrement attempts remaining on wrong password', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: false } as any);

      try {
        await service.verifyPasswordAndSendOtp(userId, password, 'PLAN_5000');
      } catch {}
      try {
        await service.verifyPasswordAndSendOtp(userId, password, 'PLAN_5000');
      } catch {}

      try {
        await service.verifyPasswordAndSendOtp(userId, password, 'PLAN_5000');
      } catch (err: any) {
        expect(err.message).toContain('attempt');
      }
    });

    it('should block after 5 failed attempts', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: false } as any);

      for (let i = 0; i < 5; i++) {
        try {
          await service.verifyPasswordAndSendOtp(userId, password, 'PLAN_5000');
        } catch {}
      }

      await expect(
        service.verifyPasswordAndSendOtp(userId, password, 'PLAN_5000'),
      ).rejects.toThrow(BadRequestException);
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
          await service.verifyPasswordAndSendOtp(userId, password, 'PLAN_5000');
        } catch {}
      }

      mockVerifyPassword.mockResolvedValue({ valid: true } as any);
      await service.verifyPasswordAndSendOtp(userId, password, 'PLAN_5000');

      mockVerifyPassword.mockResolvedValue({ valid: false } as any);
      try {
        await service.verifyPasswordAndSendOtp(userId, password, 'PLAN_5000');
      } catch (err: any) {
        expect(err.message).toContain('4 attempts remaining');
      }
    });

    it('should send withdrawal OTP email when no scheme', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: true } as any);

      await service.verifyPasswordAndSendOtp(userId, password, '');
      expect(mailService.sendWithdrawalOtpEmail).toHaveBeenCalled();
    });
  });

  describe('createApplication', () => {
    const userId = 'user-1';
    const dto = {
      scheme: 'PLAN_5000' as any,
      password: 'Test1234',
      otp: '123456',
    };

    it('should create application without wallet debit', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: true } as any);
      repo.findActiveByUserAndScheme.mockResolvedValue(null);
      repo.create.mockResolvedValue({
        id: 'app-1',
        status: 'PENDING',
        amount: { toString: () => '5000' },
      });

      const result = await service.createApplication(userId, dto);
      expect(result.id).toBe('app-1');
      expect(result.status).toBe('PENDING');
      expect(repo.create).toHaveBeenCalled();
    });

    it('should throw if user has active application for same scheme', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: true } as any);
      repo.findActiveByUserAndScheme.mockResolvedValue({ id: 'existing' });

      await expect(service.createApplication(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw for invalid scheme', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        email: 'test@test.com',
        firstName: 'Test',
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
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
      });
      mockVerifyPassword.mockResolvedValue({ valid: false } as any);

      await expect(service.createApplication(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw if user not found', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue(null);
      await expect(service.createApplication(userId, dto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('payPremium', () => {
    const userId = 'user-1';
    const app = {
      id: 'app-1',
      userId,
      scheme: 'PLAN_5000',
      status: 'VERIFIED',
      monthsPaid: 0,
      totalMonths: 120,
      amount: {
        toString: () => '5000',
        mul: (v: any) => ({ toString: () => String(5000 * v) }),
      },
      premiums: [],
      monthsMissed: 0,
    };

    it('should pay premium successfully', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        email: 'test@test.com',
        firstName: 'Test',
        passwordHash: 'hash',
        balance: { lessThan: () => false },
      });
      repo.findById.mockResolvedValue(app);
      mockVerifyPassword.mockResolvedValue({ valid: true } as any);
      repo.payPremium.mockResolvedValue({
        success: true,
        balanceAfter: { toString: () => '45000' },
        nextMonth: 2,
      });

      const result = await service.payPremium(userId, 'app-1', {
        password: 'Test1234',
        otp: '123456',
      });
      expect(result.success).toBe(true);
      expect(result.monthNumber).toBe(1);
      expect(result.advanced).toBe(false);
    });

    it('should throw if application not found', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
      });
      repo.findById.mockResolvedValue(null);

      await expect(
        service.payPremium(userId, 'app-1', {
          password: 'Test1234',
          otp: '123456',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if application belongs to different user', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
      });
      repo.findById.mockResolvedValue({ ...app, userId: 'other-user' });

      await expect(
        service.payPremium(userId, 'app-1', {
          password: 'Test1234',
          otp: '123456',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if application not VERIFIED', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
      });
      repo.findById.mockResolvedValue({ ...app, status: 'PENDING' });

      await expect(
        service.payPremium(userId, 'app-1', {
          password: 'Test1234',
          otp: '123456',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if SIP already complete', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
      });
      repo.findById.mockResolvedValue({
        ...app,
        monthsPaid: 120,
        totalMonths: 120,
      });

      await expect(
        service.payPremium(userId, 'app-1', {
          password: 'Test1234',
          otp: '123456',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw for wrong password', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
        balance: { lessThan: () => false },
      });
      repo.findById.mockResolvedValue(app);
      mockVerifyPassword.mockResolvedValue({ valid: false } as any);

      await expect(
        service.payPremium(userId, 'app-1', {
          password: 'wrong',
          otp: '123456',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if insufficient wallet balance', async () => {
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
        balance: { lessThan: () => true },
      });
      repo.findById.mockResolvedValue(app);
      mockVerifyPassword.mockResolvedValue({ valid: true } as any);

      await expect(
        service.payPremium(userId, 'app-1', {
          password: 'Test1234',
          otp: '123456',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle advance payment when current month already paid', async () => {
      const appWithPaid = {
        ...app,
        monthsPaid: 2,
        premiums: [
          { monthNumber: 1, status: 'PAID' },
          { monthNumber: 2, status: 'PAID' },
          { monthNumber: 3, status: 'PAID' },
        ],
      };
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
        balance: { lessThan: () => false },
      });
      repo.findById.mockResolvedValue(appWithPaid);
      mockVerifyPassword.mockResolvedValue({ valid: true } as any);
      repo.payPremium.mockResolvedValue({
        success: true,
        balanceAfter: { toString: () => '45000' },
        nextMonth: 4,
      });

      const result = await service.payPremium(userId, 'app-1', {
        password: 'Test1234',
        otp: '123456',
      });
      expect(result.advanced).toBe(true);
    });

    it('should throw if all months already paid', async () => {
      const allPaidPremiums = Array.from({ length: 120 }, (_, i) => ({
        monthNumber: i + 1,
        status: 'PAID',
      }));
      repo.getUserWithPasswordHash.mockResolvedValue({
        id: userId,
        passwordHash: 'hash',
      });
      repo.findById.mockResolvedValue({
        ...app,
        monthsPaid: 120,
        premiums: allPaidPremiums,
      });

      await expect(
        service.payPremium(userId, 'app-1', {
          password: 'Test1234',
          otp: '123456',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('myApplications', () => {
    it('should return enriched application list', async () => {
      repo.listMine.mockResolvedValue([
        {
          id: 'app-1',
          scheme: 'PLAN_5000',
          amount: new (require('@prisma/client').Prisma.Decimal)(5000),
          monthsPaid: 5,
          totalMonths: 120,
          monthsMissed: 0,
          status: 'VERIFIED',
          nextPaymentDue: new Date(),
          startedAt: new Date(),
          lastPaidAt: new Date(),
          submittedAt: new Date(),
          createdAt: new Date(),
          reviewNote: null,
          premiums: [],
        },
      ]);

      const result = await service.myApplications('user-1');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].planLabel).toBe('SIP PLAN_5000');
    });

    it('should return empty array for user with no applications', async () => {
      repo.listMine.mockResolvedValue([]);
      const result = await service.myApplications('user-1');
      expect(result.items).toHaveLength(0);
    });
  });

  describe('myReports', () => {
    it('should merge premiums and applications sorted by date', async () => {
      repo.premiumsForUser.mockResolvedValue([
        {
          id: 'p-1',
          status: 'PAID',
          amount: { toString: () => '5000' },
          paidAt: new Date('2026-08-01'),
          createdAt: new Date('2026-08-01'),
          monthNumber: 1,
          application: { scheme: 'PLAN_5000' },
        },
      ]);
      repo.listMine.mockResolvedValue([
        {
          id: 'app-1',
          scheme: 'PLAN_5000',
          status: 'PENDING',
          submittedAt: new Date('2026-07-01'),
          createdAt: new Date('2026-07-01'),
        },
      ]);

      const result = await service.myReports('user-1');
      expect(result.items.length).toBeGreaterThanOrEqual(2);
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
            scheme: 'PLAN_5000',
            amount: { toString: () => '5000' },
            monthsPaid: 0,
            monthsMissed: 0,
            totalMonths: 120,
            status: 'PENDING',
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
    it('should return application detail', async () => {
      repo.findById.mockResolvedValue({
        id: 'app-1',
        scheme: 'PLAN_5000',
        amount: { toString: () => '5000' },
        status: 'PENDING',
        reviewNote: null,
        submittedAt: new Date(),
        reviewedAt: null,
        verifiedAt: null,
        createdAt: new Date(),
        totalMonths: 120,
        monthsPaid: 0,
        monthsMissed: 0,
        nextPaymentDue: null,
        startedAt: null,
        lastPaidAt: null,
        user: {
          firstName: 'Test',
          lastName: 'User',
          email: 'test@test.com',
          clientId: 'C001',
          kycApplication: null,
        },
        premiums: [],
      });

      const result = await service.adminDetail('app-1');
      expect(result.id).toBe('app-1');
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
        scheme: 'PLAN_5000',
        user: { email: 'test@test.com', firstName: 'Test' },
      });
      repo.approveAndStartCycle.mockResolvedValue({
        conflicted: false,
        application: { id: 'app-1' },
      });

      const result = await service.approve('app-1', 'admin-1');
      expect(result.status).toBe('VERIFIED');
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
        scheme: 'PLAN_5000',
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
      repo.findById.mockResolvedValue({
        id: 'app-1',
        scheme: 'PLAN_5000',
      });
      repo.rejectAndRefund.mockResolvedValue({ conflicted: false });

      const result = await service.reject(
        'app-1',
        'admin-1',
        'Invalid documents',
      );
      expect(result.status).toBe('REJECTED');
    });

    it('should throw if reason too short', async () => {
      await expect(service.reject('app-1', 'admin-1', 'ab')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw if application not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.reject('nonexistent', 'admin-1', 'Valid reason'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if already processed', async () => {
      repo.findById.mockResolvedValue({ id: 'app-1' });
      repo.rejectAndRefund.mockResolvedValue({ conflicted: true });

      await expect(
        service.reject('app-1', 'admin-1', 'Valid reason'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('processMissedPayments', () => {
    it('should mark overdue months as missed', async () => {
      const pastDate = new Date('2026-01-01');
      repo.findApplicationsWithDuePremiums.mockResolvedValue([
        {
          id: 'app-1',
          scheme: 'PLAN_5000',
          nextPaymentDue: pastDate,
          user: { email: 'test@test.com', firstName: 'Test' },
        },
      ]);
      repo.markMonthMissed.mockResolvedValue({
        skipped: false,
        monthsMissed: 1,
        rejected: false,
      });
      repo.findById.mockResolvedValue({
        id: 'app-1',
        scheme: 'PLAN_5000',
        monthsPaid: 3,
        totalMonths: 120,
        premiums: [],
        user: { email: 'test@test.com', firstName: 'Test' },
      });

      const result = await service.processMissedPayments();
      expect(result.missed).toBe(1);
      expect(result.rejected).toBe(0);
    });

    it('should skip apps with future nextPaymentDue', async () => {
      const futureDate = new Date('2099-01-01');
      repo.findApplicationsWithDuePremiums.mockResolvedValue([
        {
          id: 'app-1',
          scheme: 'PLAN_5000',
          nextPaymentDue: futureDate,
          user: {},
        },
      ]);

      const result = await service.processMissedPayments();
      expect(result.missed).toBe(0);
    });

    it('should auto-reject on 4th missed payment', async () => {
      const pastDate = new Date('2026-01-01');
      repo.findApplicationsWithDuePremiums.mockResolvedValue([
        {
          id: 'app-1',
          scheme: 'PLAN_5000',
          nextPaymentDue: pastDate,
          user: { email: 'test@test.com', firstName: 'Test' },
        },
      ]);
      repo.markMonthMissed.mockResolvedValue({
        skipped: false,
        monthsMissed: 4,
        rejected: true,
      });
      repo.findById.mockResolvedValue({
        id: 'app-1',
        scheme: 'PLAN_5000',
        monthsPaid: 3,
        totalMonths: 120,
        premiums: [
          {
            amount: new (require('@prisma/client').Prisma.Decimal)(5000),
            status: 'PAID',
          },
          {
            amount: new (require('@prisma/client').Prisma.Decimal)(5000),
            status: 'PAID',
          },
          {
            amount: new (require('@prisma/client').Prisma.Decimal)(5000),
            status: 'PAID',
          },
        ],
        user: { email: 'test@test.com', firstName: 'Test' },
      });

      const result = await service.processMissedPayments();
      expect(result.rejected).toBe(1);
    });

    it('should handle empty due list', async () => {
      repo.findApplicationsWithDuePremiums.mockResolvedValue([]);
      const result = await service.processMissedPayments();
      expect(result.checked).toBe(0);
      expect(result.missed).toBe(0);
    });

    it('should skip when markMonthMissed returns skipped', async () => {
      const pastDate = new Date('2026-01-01');
      repo.findApplicationsWithDuePremiums.mockResolvedValue([
        {
          id: 'app-1',
          scheme: 'PLAN_5000',
          nextPaymentDue: pastDate,
          user: {},
        },
      ]);
      repo.markMonthMissed.mockResolvedValue({
        skipped: true,
        monthsMissed: 0,
        rejected: false,
      });

      const result = await service.processMissedPayments();
      expect(result.missed).toBe(0);
    });
  });
});
