import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { FixedDepositRepository } from './fixed-deposit.repository';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('FixedDepositRepository', () => {
  let repo: FixedDepositRepository;
  let prisma: Record<string, any>;
  let mockQueryRawResult: any[];

  const mockAudit = { log: jest.fn() };

  beforeEach(async () => {
    mockQueryRawResult = [];

    prisma = {
      fixedDepositApplication: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      fixedDepositPayout: {
        createMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      ledgerEntry: {
        create: jest.fn(),
      },
      $transaction: jest.fn((fn: Function) => {
        const tx = {
          fixedDepositApplication: prisma.fixedDepositApplication,
          fixedDepositPayout: prisma.fixedDepositPayout,
          user: prisma.user,
          ledgerEntry: prisma.ledgerEntry,
          $queryRaw: jest
            .fn()
            .mockImplementation(() => Promise.resolve(mockQueryRawResult)),
        };
        return fn(tx);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FixedDepositRepository,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    repo = module.get(FixedDepositRepository);
  });

  describe('getSchemes', () => {
    it('should return 3 schemes', () => {
      const schemes = repo.getSchemes();
      expect(schemes).toHaveLength(3);
    });

    it('should return FD_25000 with correct values', () => {
      const schemes = repo.getSchemes();
      const fd25 = schemes.find((s) => s.id === 'FD_25000');
      expect(fd25).toBeDefined();
      expect(fd25!.depositAmount).toBe(25000);
      expect(fd25!.lockInMonths).toBe(48);
      expect(fd25!.payoutMode).toBe('quarterly');
      expect(fd25!.emiAmount).toBe(3130);
      expect(fd25!.totalEmis).toBe(16);
      expect(fd25!.totalPayout).toBe(50080);
    });

    it('should return FD_50000 with correct values', () => {
      const schemes = repo.getSchemes();
      const fd50 = schemes.find((s) => s.id === 'FD_50000');
      expect(fd50).toBeDefined();
      expect(fd50!.depositAmount).toBe(50000);
      expect(fd50!.lockInMonths).toBe(42);
      expect(fd50!.payoutMode).toBe('quarterly');
      expect(fd50!.emiAmount).toBe(7145);
      expect(fd50!.totalEmis).toBe(14);
      expect(fd50!.totalPayout).toBe(100030);
    });

    it('should return FD_100000 with correct values', () => {
      const schemes = repo.getSchemes();
      const fd100 = schemes.find((s) => s.id === 'FD_100000');
      expect(fd100).toBeDefined();
      expect(fd100!.depositAmount).toBe(100000);
      expect(fd100!.lockInMonths).toBe(40);
      expect(fd100!.payoutMode).toBe('monthly');
      expect(fd100!.emiAmount).toBe(5000);
      expect(fd100!.totalEmis).toBe(40);
      expect(fd100!.totalPayout).toBe(200000);
    });
  });

  describe('getSchemeById', () => {
    it('should return scheme for valid id', () => {
      expect(repo.getSchemeById('FD_25000')).toBeDefined();
      expect(repo.getSchemeById('FD_50000')).toBeDefined();
      expect(repo.getSchemeById('FD_100000')).toBeDefined();
    });

    it('should return undefined for invalid id', () => {
      expect(repo.getSchemeById('INVALID' as any)).toBeUndefined();
    });
  });

  describe('create', () => {
    it('should create application with correct data', async () => {
      const mockApp = { id: 'app-1', userId: 'user-1', planId: 'FD_25000' };
      prisma.fixedDepositApplication.create.mockResolvedValue(mockApp);

      const result = await repo.create('user-1', 'FD_25000');
      expect(result).toEqual(mockApp);
      expect(prisma.fixedDepositApplication.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          planId: 'FD_25000',
          status: 'PENDING',
        }),
      });
    });

    it('should throw BadRequestException for invalid plan', async () => {
      await expect(repo.create('user-1', 'INVALID' as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findActiveByUser', () => {
    it('should find active application by user and plan', async () => {
      const mockApp = { id: 'app-1', planId: 'FD_25000' };
      prisma.fixedDepositApplication.findFirst.mockResolvedValue(mockApp);

      const result = await repo.findActiveByUser('user-1', 'FD_25000');
      expect(result).toEqual(mockApp);
      expect(prisma.fixedDepositApplication.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          planId: 'FD_25000',
          status: { in: ['PENDING', 'VERIFIED'] },
        },
      });
    });

    it('should find active application by user without plan filter', async () => {
      prisma.fixedDepositApplication.findFirst.mockResolvedValue(null);

      await repo.findActiveByUser('user-1');
      expect(prisma.fixedDepositApplication.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          status: { in: ['PENDING', 'VERIFIED'] },
        },
      });
    });

    it('should return null when no active application', async () => {
      prisma.fixedDepositApplication.findFirst.mockResolvedValue(null);
      const result = await repo.findActiveByUser('user-1', 'FD_25000');
      expect(result).toBeNull();
    });
  });

  describe('listMine', () => {
    it('should return user applications with payouts', async () => {
      const mockApps = [{ id: 'app-1', payouts: [] }];
      prisma.fixedDepositApplication.findMany.mockResolvedValue(mockApps);

      const result = await repo.listMine('user-1');
      expect(result).toEqual(mockApps);
      expect(prisma.fixedDepositApplication.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        include: { payouts: { orderBy: { emiNumber: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findById', () => {
    it('should return application with user and payouts', async () => {
      const mockApp = { id: 'app-1', user: {}, payouts: [] };
      prisma.fixedDepositApplication.findUnique.mockResolvedValue(mockApp);

      const result = await repo.findById('app-1');
      expect(result).toEqual(mockApp);
    });

    it('should return null for non-existent id', async () => {
      prisma.fixedDepositApplication.findUnique.mockResolvedValue(null);
      const result = await repo.findById('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('should return paginated results', async () => {
      const mockItems = [{ id: 'app-1' }];
      prisma.fixedDepositApplication.findMany.mockResolvedValue(mockItems);
      prisma.fixedDepositApplication.count.mockResolvedValue(1);

      const result = await repo.list({ page: 1, pageSize: 10 });
      expect(result).toEqual({ items: mockItems, total: 1 });
    });

    it('should filter by userId', async () => {
      prisma.fixedDepositApplication.findMany.mockResolvedValue([]);
      prisma.fixedDepositApplication.count.mockResolvedValue(0);

      await repo.list({ userId: 'user-1', page: 1, pageSize: 10 });
      expect(prisma.fixedDepositApplication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1' }),
        }),
      );
    });

    it('should filter by status', async () => {
      prisma.fixedDepositApplication.findMany.mockResolvedValue([]);
      prisma.fixedDepositApplication.count.mockResolvedValue(0);

      await repo.list({ status: 'PENDING', page: 1, pageSize: 10 });
      expect(prisma.fixedDepositApplication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
    });

    it('should filter by search', async () => {
      prisma.fixedDepositApplication.findMany.mockResolvedValue([]);
      prisma.fixedDepositApplication.count.mockResolvedValue(0);

      await repo.list({ search: 'test', page: 1, pageSize: 10 });
      expect(prisma.fixedDepositApplication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ user: expect.any(Object) }),
            ]),
          }),
        }),
      );
    });
  });

  describe('approveAndStartCycle', () => {
    it('should approve and create payout rows', async () => {
      const mockApp = {
        id: 'app-1',
        userId: 'user-1',
        status: 'PENDING',
        totalEmis: 2,
        payoutMode: 'monthly',
        emiAmount: { toNumber: () => 5000 },
        depositAmount: { toNumber: () => 100000 },
      };
      const mockUpdated = { ...mockApp, status: 'VERIFIED' };
      mockQueryRawResult = [mockApp];
      prisma.user.findUnique.mockResolvedValue({ balance: 200000 });
      prisma.fixedDepositApplication.update.mockResolvedValue(mockUpdated);
      prisma.fixedDepositPayout.createMany.mockResolvedValue({ count: 2 });
      prisma.user.update.mockResolvedValue({ balance: 0 });
      prisma.ledgerEntry.create.mockResolvedValue({});

      const result = await repo.approveAndStartCycle('app-1', 'admin-1');
      expect(result.conflicted).toBe(false);
      expect(result.application).toEqual(mockUpdated);
    });

    it('should return conflicted if not PENDING', async () => {
      mockQueryRawResult = [
        {
          id: 'app-1',
          status: 'VERIFIED',
        },
      ];

      const result = await repo.approveAndStartCycle('app-1', 'admin-1');
      expect(result.conflicted).toBe(true);
    });

    it('should return conflicted if not found', async () => {
      mockQueryRawResult = [];

      const result = await repo.approveAndStartCycle('non-existent', 'admin-1');
      expect(result.conflicted).toBe(true);
    });
  });

  describe('rejectAndRefund', () => {
    it('should reject PENDING application', async () => {
      prisma.fixedDepositApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        status: 'PENDING',
      });
      prisma.fixedDepositApplication.update.mockResolvedValue({});

      const result = await repo.rejectAndRefund(
        'app-1',
        'admin-1',
        'Not interested',
      );
      expect(result.conflicted).toBe(false);
    });

    it('should return conflicted if not PENDING', async () => {
      prisma.fixedDepositApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        status: 'VERIFIED',
      });

      const result = await repo.rejectAndRefund('app-1', 'admin-1', 'reason');
      expect(result.conflicted).toBe(true);
    });
  });

  describe('findDuePayouts', () => {
    it('should return verified apps with past nextPayoutAt', async () => {
      const mockApps = [{ id: 'app-1', payouts: [{ emiNumber: 1 }] }];
      prisma.fixedDepositApplication.findMany.mockResolvedValue(mockApps);

      const result = await repo.findDuePayouts();
      expect(result).toEqual(mockApps);
      expect(prisma.fixedDepositApplication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'VERIFIED',
            nextPayoutAt: expect.objectContaining({ lt: expect.any(Date) }),
          }),
        }),
      );
    });
  });

  describe('calculateNextPayout (via approve)', () => {
    it('should calculate quarterly next payout correctly', async () => {
      const now = new Date();
      mockQueryRawResult = [
        {
          id: 'app-1',
          userId: 'user-1',
          status: 'PENDING',
          totalEmis: 2,
          payoutMode: 'quarterly',
          emiAmount: { toNumber: () => 3130 },
          depositAmount: { toNumber: () => 25000 },
        },
      ];
      prisma.user.findUnique.mockResolvedValue({ balance: 50000 });
      prisma.fixedDepositApplication.update.mockResolvedValue({});
      prisma.fixedDepositPayout.createMany.mockResolvedValue({ count: 2 });
      prisma.user.update.mockResolvedValue({ balance: 0 });
      prisma.ledgerEntry.create.mockResolvedValue({});

      await repo.approveAndStartCycle('app-1', 'admin-1');

      const updateCall = prisma.fixedDepositApplication.update.mock.calls[0][0];
      const nextPayout = updateCall.data.nextPayoutAt;
      expect(nextPayout).toBeInstanceOf(Date);
      expect(nextPayout.getMonth()).toBe((now.getMonth() + 3) % 12);
      // The anchor day must be preserved (not reset to the 1st).
      expect(nextPayout.getUTCDate()).toBe(now.getUTCDate());
    });

    it('should calculate monthly next payout correctly', async () => {
      const now = new Date();
      mockQueryRawResult = [
        {
          id: 'app-1',
          userId: 'user-1',
          status: 'PENDING',
          totalEmis: 2,
          payoutMode: 'monthly',
          emiAmount: { toNumber: () => 5000 },
          depositAmount: { toNumber: () => 100000 },
        },
      ];
      prisma.user.findUnique.mockResolvedValue({ balance: 200000 });
      prisma.fixedDepositApplication.update.mockResolvedValue({});
      prisma.fixedDepositPayout.createMany.mockResolvedValue({ count: 2 });
      prisma.user.update.mockResolvedValue({ balance: 0 });
      prisma.ledgerEntry.create.mockResolvedValue({});

      await repo.approveAndStartCycle('app-1', 'admin-1');

      const updateCall = prisma.fixedDepositApplication.update.mock.calls[0][0];
      const nextPayout = updateCall.data.nextPayoutAt;
      expect(nextPayout).toBeInstanceOf(Date);
      expect(nextPayout.getMonth()).toBe((now.getMonth() + 1) % 12);
      // The anchor day must be preserved (not reset to the 1st).
      expect(nextPayout.getUTCDate()).toBe(now.getUTCDate());
    });
  });

  describe('payout schedule anchor (option B)', () => {
    it('derives EMI due dates from the anchor day, not the 1st', () => {
      const anchor = new Date('2026-06-20T04:30:00.000Z');
      const sixth = (repo as any).nextDueDate(anchor, 'monthly', 6);
      expect(sixth.toISOString()).toBe('2026-12-20T04:30:00.000Z');
    });

    it('derives quarterly due dates correctly', () => {
      const anchor = new Date('2026-06-20T04:30:00.000Z');
      const fourth = (repo as any).nextDueDate(anchor, 'quarterly', 4);
      expect(fourth.toISOString()).toBe('2027-06-20T04:30:00.000Z');
    });

    it('clamps 31 Jan to 28 Feb (non-leap)', () => {
      const out = (repo as any).addMonthsClamped(
        new Date('2027-01-31T04:30:00.000Z'),
        1,
      );
      expect(out.toISOString()).toBe('2027-02-28T04:30:00.000Z');
    });

    it('clamps 31 Jan to 29 Feb (leap year)', () => {
      const out = (repo as any).addMonthsClamped(
        new Date('2028-01-31T04:30:00.000Z'),
        1,
      );
      expect(out.toISOString()).toBe('2028-02-29T04:30:00.000Z');
    });

    it('returns to the 31st after a short month when derived from the anchor', () => {
      const anchor = new Date('2027-01-31T04:30:00.000Z');
      const out = (repo as any).addMonthsClamped(anchor, 3); // April
      expect(out.toISOString()).toBe('2027-04-30T04:30:00.000Z');
      const may = (repo as any).addMonthsClamped(anchor, 4);
      expect(may.toISOString()).toBe('2027-05-31T04:30:00.000Z');
    });
  });

  describe('refundVerifiedDeposit', () => {
    it('should refund a VERIFIED deposit with a valid FD_REFUND ledger entry', async () => {
      prisma.fixedDepositApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        userId: 'user-1',
        status: 'VERIFIED',
        depositAmount: { toNumber: () => 50000 },
      });
      prisma.user.update.mockResolvedValue({ balance: 50000 });
      prisma.fixedDepositApplication.update.mockResolvedValue({});

      const result = await repo.refundVerifiedDeposit(
        'app-1',
        'admin-1',
        'Customer request',
      );

      expect(result.conflicted).toBe(false);
      expect(result.newBalance).toEqual(50000);
      expect(prisma.ledgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          direction: 'CREDIT',
          sourceType: 'FD_REFUND',
          sourceId: 'app-1',
        }),
      });
      expect(prisma.fixedDepositApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: expect.objectContaining({
          status: 'REJECTED',
          reviewedBy: 'admin-1',
        }),
      });
    });

    it('should return conflicted if application is not VERIFIED', async () => {
      prisma.fixedDepositApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        status: 'PENDING',
      });

      const result = await repo.refundVerifiedDeposit('app-1', 'admin-1', 'x');
      expect(result.conflicted).toBe(true);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('creditPayout', () => {
    it('should credit a pending payout and advance the application', async () => {
      mockQueryRawResult = [
        {
          id: 'payout-1',
          applicationId: 'app-1',
          userId: 'user-1',
          emiNumber: 1,
          amount: 3130,
          status: 'PENDING',
        },
      ];
      prisma.fixedDepositApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        status: 'VERIFIED',
        emisPaid: 0,
        totalEmis: 16,
        payoutMode: 'quarterly',
        verifiedAt: new Date('2026-06-20T04:30:00.000Z'),
      });
      prisma.user.update.mockResolvedValue({ balance: 3130 });
      prisma.fixedDepositPayout.update.mockResolvedValue({});
      prisma.fixedDepositApplication.update.mockResolvedValue({});

      const result = await repo.creditPayout('app-1', 1);

      expect(result).not.toBeNull();
      expect(result!.isComplete).toBe(false);
      expect(prisma.fixedDepositPayout.update).toHaveBeenCalledWith({
        where: { id: 'payout-1' },
        data: expect.objectContaining({ status: 'PAID' }),
      });
      // EMI 2 of a quarterly plan anchored on 20 Jun = 20 Dec, not 1 Jan.
      const appUpdate =
        prisma.fixedDepositApplication.update.mock.calls[0][0].data;
      expect((appUpdate.nextPayoutAt as Date).toISOString()).toBe(
        '2026-12-20T04:30:00.000Z',
      );
      expect(prisma.ledgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sourceType: 'FD_PAYOUT',
          amount: 3130,
          userId: 'user-1',
        }),
      });
    });

    it('keeps the 20th for a backfilled FD after paying EMI 5', async () => {
      mockQueryRawResult = [
        {
          id: 'payout-5',
          applicationId: 'app-1',
          userId: 'user-1',
          emiNumber: 5,
          amount: 5000,
          status: 'PENDING',
        },
      ];
      prisma.fixedDepositApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        status: 'VERIFIED',
        emisPaid: 4,
        totalEmis: 40,
        payoutMode: 'monthly',
        verifiedAt: new Date('2026-06-20T04:30:00.000Z'),
        nextPayoutAt: new Date('2026-11-20T04:30:00.000Z'),
      });
      prisma.user.update.mockResolvedValue({ balance: 25000 });
      prisma.fixedDepositPayout.update.mockResolvedValue({});
      prisma.fixedDepositApplication.update.mockResolvedValue({});

      const result = await repo.creditPayout('app-1', 5);

      expect(result).not.toBeNull();
      const appUpdate =
        prisma.fixedDepositApplication.update.mock.calls[0][0].data;
      expect(appUpdate.emisPaid).toBe(5);
      expect((appUpdate.nextPayoutAt as Date).toISOString()).toBe(
        '2026-12-20T04:30:00.000Z',
      );
    });

    it('should return null when the payout is already paid', async () => {
      mockQueryRawResult = [
        { id: 'payout-1', status: 'PAID', userId: 'user-1', amount: 3130 },
      ];

      const result = await repo.creditPayout('app-1', 1);
      expect(result).toBeNull();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('should return null when the application is no longer VERIFIED', async () => {
      mockQueryRawResult = [
        {
          id: 'payout-1',
          userId: 'user-1',
          amount: 3130,
          status: 'PENDING',
        },
      ];
      prisma.fixedDepositApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        status: 'REJECTED',
      });

      const result = await repo.creditPayout('app-1', 1);
      expect(result).toBeNull();
    });
  });
});
