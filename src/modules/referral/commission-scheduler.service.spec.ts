import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CommissionSchedulerService } from './commission-scheduler.service';
import { CommissionConfigService } from './commission-config.service';
import { CommissionService } from './commission.service';
import { InvestmentEligibilityService } from './investment-eligibility.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Regression coverage for spec §14: a Fixed Deposit / Investment Fund
 * application is ONE qualifying commission event, pegged to the cycle in
 * which it was approved. Before this guard existed the scheduler fetched
 * every VERIFIED row with no date filter, so the same deposit earned
 * commission again every month for the whole lock-in.
 */
describe('CommissionSchedulerService', () => {
  let service: CommissionSchedulerService;

  const prisma = {
    user: { findMany: jest.fn() },
    referralRelationship: { findMany: jest.fn() },
    investmentApplication: { findMany: jest.fn() },
    fixedDepositApplication: { findMany: jest.fn() },
    sIPForChildPremium: { findMany: jest.fn() },
  };
  const config = {
    get: jest.fn(),
    maxUnlockedLevel: jest.fn(),
  };
  const commissions = { calculateAndRecord: jest.fn() };
  const eligibility = {
    hasQualifyingActiveInvestment: jest.fn(),
    countVerifiedDirectReferrals: jest.fn(),
  };
  const audit = { log: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    prisma.user.findMany.mockResolvedValue([{ id: 'referrer-1' }]);
    prisma.referralRelationship.findMany.mockResolvedValue([
      { referredUserId: 'referred-1' },
    ]);
    prisma.investmentApplication.findMany.mockResolvedValue([]);
    prisma.fixedDepositApplication.findMany.mockResolvedValue([]);
    prisma.sIPForChildPremium.findMany.mockResolvedValue([]);

    config.get.mockResolvedValue({ maxDepth: 5 });
    config.maxUnlockedLevel.mockResolvedValue(1);
    eligibility.hasQualifyingActiveInvestment.mockResolvedValue(true);
    eligibility.countVerifiedDirectReferrals.mockResolvedValue(1);
    commissions.calculateAndRecord.mockResolvedValue({
      id: 'commission-1',
      amount: new Prisma.Decimal(250),
    });
    audit.log.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommissionSchedulerService,
        { provide: PrismaService, useValue: prisma },
        { provide: CommissionConfigService, useValue: config },
        { provide: CommissionService, useValue: commissions },
        { provide: InvestmentEligibilityService, useValue: eligibility },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(CommissionSchedulerService);
  });

  it('scopes Fund and FD commission queries to the cycle month', async () => {
    await service.runCycle({ month: 1, year: 2024 });

    // Cycle 2024-01 in IST === 2023-12-31T18:30Z .. 2024-01-31T18:30Z
    const expectedStart = new Date(Date.UTC(2024, 0, 1, 0, 0, 0) - 330 * 60_000);
    const expectedEnd = new Date(Date.UTC(2024, 1, 1, 0, 0, 0) - 330 * 60_000);

    expect(prisma.investmentApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'referred-1',
          verifiedAt: { gte: expectedStart, lt: expectedEnd },
        }),
      }),
    );
    expect(prisma.fixedDepositApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'referred-1',
          verifiedAt: { gte: expectedStart, lt: expectedEnd },
        }),
      }),
    );

    // SIP remains scoped by the actual paidAt of each premium.
    expect(prisma.sIPForChildPremium.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'referred-1',
          status: 'PAID',
          paidAt: { gte: expectedStart, lt: expectedEnd },
        }),
      }),
    );
  });

  it('records exactly one commission per Fund/FD event, never per month', async () => {
    prisma.investmentApplication.findMany.mockResolvedValue([
      { id: 'fund-1', amount: new Prisma.Decimal(10000) },
    ]);
    prisma.fixedDepositApplication.findMany.mockResolvedValue([
      { id: 'fd-1', depositAmount: new Prisma.Decimal(50000) },
    ]);

    const result = await service.runCycle({ month: 1, year: 2024 });

    expect(commissions.calculateAndRecord).toHaveBeenCalledTimes(2);
    expect(commissions.calculateAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        investmentId: 'fund-1',
        investmentAmount: new Prisma.Decimal(10000),
        commissionMonth: 1,
        commissionYear: 2024,
      }),
    );
    expect(commissions.calculateAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        investmentId: 'fd-1',
        investmentAmount: new Prisma.Decimal(50000),
        commissionMonth: 1,
        commissionYear: 2024,
      }),
    );
    expect(result.commissionsCreated).toBe(2);
  });
});
