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
 * ADMIN is always ineligible. Otherwise, the function returns true when
 * ANY product type has a qualifying (VERIFIED or COMPLETED) record.
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
          if (
            args.where.status.in?.includes(InvestmentStatus.VERIFIED) ||
            args.where.status.in?.includes(InvestmentStatus.COMPLETED)
          ) {
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

  it('treats a COMPLETED investment fund as qualifying (matured, not inactive)', async () => {
    const prisma = makePrisma({ fundCount: 1 });
    (service as any).prisma = prisma;
    expect(await service.hasQualifyingActiveInvestment('u1')).toBe(true);
    const call = (prisma.investmentApplication.count as jest.Mock).mock
      .calls[0][0];
    expect(call.where.status.in).toEqual(
      expect.arrayContaining([
        InvestmentStatus.VERIFIED,
        InvestmentStatus.COMPLETED,
      ]),
    );
  });

  it('treats a COMPLETED fixed deposit as qualifying (matured, not inactive)', async () => {
    const prisma = makePrisma({ fdCount: 1 });
    (service as any).prisma = prisma;
    expect(await service.hasQualifyingActiveInvestment('u1')).toBe(true);
    const call = (prisma.fixedDepositApplication.count as jest.Mock).mock
      .calls[0][0];
    expect(call.where.status.in).toEqual(
      expect.arrayContaining([
        FixedDepositStatus.VERIFIED,
        FixedDepositStatus.COMPLETED,
      ]),
    );
  });
});
