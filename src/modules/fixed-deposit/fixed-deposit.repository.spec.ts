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
    });
  });
});
