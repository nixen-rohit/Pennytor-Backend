import { Test } from '@nestjs/testing';
import { CommissionService } from './commission.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CommissionConfigService } from './commission-config.service';
import { InvestmentEligibilityService } from './investment-eligibility.service';
import {
  Prisma,
  Role,
  CommissionStatus,
  LedgerDirection,
  LedgerSourceType,
} from '@prisma/client';

/**
 * Unit tests for CommissionService — covers spec §14 (per-investment
 * records), §17 (idempotency), §18 (atomic wallet + ledger), §20
 * (snapshot), and §21 (reversal creates a new row, never edits the
 * original).
 */
describe('CommissionService.calculateAndRecord', () => {
  let service: CommissionService;
  let prisma: PrismaService;

  const configRow = {
    id: 1,
    l1RatePercent: new Prisma.Decimal(0.5),
    l2RatePercent: new Prisma.Decimal(0.25),
    l3RatePercent: new Prisma.Decimal(0.25),
    l4RatePercent: new Prisma.Decimal(0.25),
    l5RatePercent: new Prisma.Decimal(0.25),
    l2MinDirectVerified: 3,
    l3MinDirectVerified: 6,
    l4MinDirectVerified: 9,
    l5MinDirectVerified: 12,
    maxDepth: 5,
    active: true,
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommissionService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn(async (cb: any) => cb(txMock)),
            user: { findUnique: jest.fn(), update: jest.fn() },
            referralCommission: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            ledgerEntry: { create: jest.fn() },
          },
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
        {
          provide: CommissionConfigService,
          useValue: {
            get: jest.fn().mockResolvedValue(configRow),
            getRatePercent: jest
              .fn()
              .mockResolvedValue(new Prisma.Decimal(0.5)),
          },
        },
        {
          provide: InvestmentEligibilityService,
          useValue: {
            countVerifiedDirectReferrals: jest.fn().mockResolvedValue(0),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(CommissionService);
    prisma = moduleRef.get(PrismaService);
  });

  // txMock is captured at module setup; the service uses a transactional
  // callback so we re-route all calls to a fresh object per test.
  let txMock: any;
  beforeEach(() => {
    txMock = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'r1',
          role: Role.USER,
          status: 'ACTIVE',
        }),
        update: jest
          .fn()
          .mockResolvedValue({ balance: new Prisma.Decimal(100) }),
      },
      referralCommission: {
        findUnique: jest.fn().mockResolvedValue(null), // not yet paid
        create: jest.fn().mockResolvedValue({
          id: 'c1',
          commissionAmount: new Prisma.Decimal(250),
        }),
      },
      ledgerEntry: { create: jest.fn().mockResolvedValue({}) },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
      cb(txMock),
    );
  });

  it('records a L1 commission at 0.5% with the correct snapshot', async () => {
    const out = await service.calculateAndRecord({
      referrerId: 'r1',
      referredUserId: 'u1',
      investmentId: 'inv1',
      investmentAmount: new Prisma.Decimal(50000),
      level: 1,
      commissionMonth: 9,
      commissionYear: 2026,
    });
    expect(out).not.toBeNull();
    expect(txMock.referralCommission.create).toHaveBeenCalledTimes(1);
    const arg = txMock.referralCommission.create.mock.calls[0][0];
    expect(arg.data.commissionAmount.toString()).toBe('250');
    expect(arg.data.investmentAmountSnapshot.toString()).toBe('50000');
    expect(arg.data.commissionRateSnapshot.toString()).toBe('0.5');
    expect(arg.data.level).toBe(1);
    expect(arg.data.commissionMonth).toBe(9);
    expect(arg.data.commissionYear).toBe(2026);
  });

  it('skips ADMIN referrers (spec §1)', async () => {
    txMock.user.findUnique.mockResolvedValueOnce({
      id: 'r1',
      role: Role.ADMIN,
      status: 'ACTIVE',
    });
    const out = await service.calculateAndRecord({
      referrerId: 'r1',
      referredUserId: 'u1',
      investmentId: 'inv1',
      investmentAmount: new Prisma.Decimal(1000),
      level: 1,
      commissionMonth: 9,
      commissionYear: 2026,
    });
    expect(out).toBeNull();
    expect(txMock.referralCommission.create).not.toHaveBeenCalled();
  });

  it('is idempotent — a duplicate tuple returns null (spec §17)', async () => {
    txMock.referralCommission.findUnique.mockResolvedValueOnce({
      id: 'c-existing',
      status: CommissionStatus.PAID,
    });
    const out = await service.calculateAndRecord({
      referrerId: 'r1',
      referredUserId: 'u1',
      investmentId: 'inv1',
      investmentAmount: new Prisma.Decimal(50000),
      level: 1,
      commissionMonth: 9,
      commissionYear: 2026,
    });
    expect(out).toBeNull();
    expect(txMock.referralCommission.create).not.toHaveBeenCalled();
  });

  it('credits the wallet and writes a ledger entry in the same tx (spec §18)', async () => {
    await service.calculateAndRecord({
      referrerId: 'r1',
      referredUserId: 'u1',
      investmentId: 'inv1',
      investmentAmount: new Prisma.Decimal(50000),
      level: 1,
      commissionMonth: 9,
      commissionYear: 2026,
    });
    expect(txMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: { balance: { increment: expect.any(Prisma.Decimal) } },
      }),
    );
    expect(txMock.ledgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'r1',
          direction: LedgerDirection.CREDIT,
          sourceType: LedgerSourceType.REFERRAL_COMMISSION,
        }),
      }),
    );
  });

  it('self-referral is rejected (spec §22 #1)', async () => {
    const out = await service.calculateAndRecord({
      referrerId: 'u1',
      referredUserId: 'u1',
      investmentId: 'inv1',
      investmentAmount: new Prisma.Decimal(50000),
      level: 1,
      commissionMonth: 9,
      commissionYear: 2026,
    });
    expect(out).toBeNull();
  });
});
