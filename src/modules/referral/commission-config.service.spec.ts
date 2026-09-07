import { CommissionConfigService } from './commission-config.service';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * Unit tests for CommissionConfigService — covers spec §12 thresholds
 * and the L1–L5 / L6+ boundary.
 */
describe('CommissionConfigService', () => {
  let prisma: jest.Mocked<PrismaService>;
  let service: CommissionConfigService;

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

  beforeEach(() => {
    prisma = {
      commissionLevelConfig: {
        findUnique: jest.fn().mockResolvedValue(configRow),
        create: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;
    service = new CommissionConfigService(prisma);
  });

  it('L1 unlocks at 0 verified direct referrals', async () => {
    expect(await service.maxUnlockedLevel(0)).toBe(1);
  });

  it('L2 unlocks at 3 verified direct referrals (spec §12)', async () => {
    expect(await service.maxUnlockedLevel(3)).toBe(2);
    expect(await service.maxUnlockedLevel(2)).toBe(1);
  });

  it('L3 unlocks at 6', async () => {
    expect(await service.maxUnlockedLevel(6)).toBe(3);
  });

  it('L4 unlocks at 9', async () => {
    expect(await service.maxUnlockedLevel(9)).toBe(4);
  });

  it('L5 unlocks at 12', async () => {
    expect(await service.maxUnlockedLevel(12)).toBe(5);
  });

  it('returns L1 for a user with no direct verified referrals', async () => {
    expect(await service.maxUnlockedLevel(0)).toBe(1);
  });

  it('getRatePercent returns 0 for level 0 (L6+)', async () => {
    expect((await service.getRatePercent(0)).toNumber()).toBe(0);
  });

  it('getRatePercent returns 0 for any level > maxDepth', async () => {
    expect((await service.getRatePercent(6)).toNumber()).toBe(0);
    expect((await service.getRatePercent(99)).toNumber()).toBe(0);
  });

  it('getRatePercent returns the configured rate for L1–L5', async () => {
    expect((await service.getRatePercent(1)).toNumber()).toBe(0.5);
    expect((await service.getRatePercent(2)).toNumber()).toBe(0.25);
    expect((await service.getRatePercent(3)).toNumber()).toBe(0.25);
    expect((await service.getRatePercent(4)).toNumber()).toBe(0.25);
    expect((await service.getRatePercent(5)).toNumber()).toBe(0.25);
  });
});
