import { Test } from '@nestjs/testing';
import { InvestmentEligibilityService } from './investment-eligibility.service';
import { PrismaService } from '../../database/prisma.service';
import {
  Role,
  InvestmentStatus,
  SIPStatus,
  FixedDepositStatus,
} from '@prisma/client';

/**
 * Spec §9: hasQualifyingActiveInvestment is the single source of truth.
 * ADMIN is always ineligible. Otherwise, the function returns true
 * when ANY of the three product types has a VERIFIED record.
 */
describe('InvestmentEligibilityService.hasQualifyingActiveInvestment', () => {
  let service: InvestmentEligibilityService;

  const baseUser = { id: 'u1', role: Role.USER };

  function makePrisma(opts: {
    fundCount?: number;
    sipCount?: number;
    fdCount?: number;
    role?: Role;
  }) {
    return {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          ...baseUser,
          role: opts.role ?? Role.USER,
        }),
      },
      investmentApplication: {
        count: jest.fn().mockImplementation((args: any) => {
          if (args.where.status === InvestmentStatus.VERIFIED) {
            return Promise.resolve(opts.fundCount ?? 0);
          }
          return Promise.resolve(0);
        }),
      },
      sIPForChildApplication: {
        count: jest.fn().mockImplementation((args: any) => {
          if (args.where.status === SIPStatus.VERIFIED) {
            return Promise.resolve(opts.sipCount ?? 0);
          }
          return Promise.resolve(0);
        }),
      },
      fixedDepositApplication: {
        count: jest.fn().mockImplementation((args: any) => {
          if (
            args.where.status.in &&
            args.where.status.in.includes(FixedDepositStatus.VERIFIED)
          ) {
            return Promise.resolve(opts.fdCount ?? 0);
          }
          return Promise.resolve(0);
        }),
      },
      referralRelationship: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        InvestmentEligibilityService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(InvestmentEligibilityService);
  });

  it('returns false for ADMIN (spec §1)', async () => {
    (service as any).prisma = makePrisma({ role: Role.ADMIN });
    expect(await service.hasQualifyingActiveInvestment('u1')).toBe(false);
  });

  it('returns false when the user has no investments', async () => {
    (service as any).prisma = makePrisma({});
    expect(await service.hasQualifyingActiveInvestment('u1')).toBe(false);
  });

  it('returns true when there is a verified investment fund', async () => {
    (service as any).prisma = makePrisma({ fundCount: 1 });
    expect(await service.hasQualifyingActiveInvestment('u1')).toBe(true);
  });

  it('returns true when there is a verified SIP', async () => {
    (service as any).prisma = makePrisma({ sipCount: 1 });
    expect(await service.hasQualifyingActiveInvestment('u1')).toBe(true);
  });

  it('returns true when there is a verified FD', async () => {
    (service as any).prisma = makePrisma({ fdCount: 1 });
    expect(await service.hasQualifyingActiveInvestment('u1')).toBe(true);
  });
});
