import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Spec §12: L1–L5 commission thresholds and rates. NO hardcoded rates
 * anywhere else in the codebase — everything goes through this service.
 *
 * The defaults match the spec exactly:
 *   L1: 0.50%   (≥ 0 direct verified referrals)
 *   L2: 0.25%   (≥ 3)
 *   L3: 0.25%   (≥ 6)
 *   L4: 0.25%   (≥ 9)
 *   L5: 0.25%   (≥ 12)
 *   L6+: 0%
 *
 * The configuration is persisted in `commission_level_config` so that
 * admins can tune it later without code changes. Historical commission
 * records store the snapshot of the rate at calculation time (spec §20),
 * so changing the config never alters a paid record.
 */
@Injectable()
export class CommissionConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the active config; seeds the defaults on first read. */
  async get(): Promise<CommissionConfig> {
    const existing = await this.prisma.commissionLevelConfig.findUnique({
      where: { id: 1 },
    });
    if (existing) return existing as CommissionConfig;
    return (await this.prisma.commissionLevelConfig.create({
      data: {
        id: 1,
        l1RatePercent: new Prisma.Decimal(0.5),
        l2RatePercent: new Prisma.Decimal(0.25),
        l3RatePercent: new Prisma.Decimal(0.25),
        l4RatePercent: new Prisma.Decimal(0.25),
        l5RatePercent: new Prisma.Decimal(0.25),
      },
    })) as CommissionConfig;
  }

  /**
   * Spec §12: given a count of verified direct (L1) referrals, returns
   * the highest commission level (1..5) that is currently unlocked.
   * L6+ return 0, which means "no commission".
   */
  async maxUnlockedLevel(directVerifiedCount: number): Promise<number> {
    const cfg = await this.get();
    if (directVerifiedCount >= cfg.l5MinDirectVerified) return 5;
    if (directVerifiedCount >= cfg.l4MinDirectVerified) return 4;
    if (directVerifiedCount >= cfg.l3MinDirectVerified) return 3;
    if (directVerifiedCount >= cfg.l2MinDirectVerified) return 2;
    return 1;
  }

  /**
   * Returns the rate (as a percent, e.g. 0.5 = 0.5%) for the given level.
   * Level 0 or any level > maxDepth returns 0.
   */
  async getRatePercent(level: number): Promise<Prisma.Decimal> {
    if (level <= 0) return new Prisma.Decimal(0);
    const cfg = await this.get();
    if (level > cfg.maxDepth) return new Prisma.Decimal(0);
    switch (level) {
      case 1:
        return cfg.l1RatePercent;
      case 2:
        return cfg.l2RatePercent;
      case 3:
        return cfg.l3RatePercent;
      case 4:
        return cfg.l4RatePercent;
      case 5:
        return cfg.l5RatePercent;
      default:
        return new Prisma.Decimal(0);
    }
  }
}

export interface CommissionConfig {
  id: number;
  l1RatePercent: Prisma.Decimal;
  l2RatePercent: Prisma.Decimal;
  l3RatePercent: Prisma.Decimal;
  l4RatePercent: Prisma.Decimal;
  l5RatePercent: Prisma.Decimal;
  l2MinDirectVerified: number;
  l3MinDirectVerified: number;
  l4MinDirectVerified: number;
  l5MinDirectVerified: number;
  maxDepth: number;
  active: boolean;
  updatedAt: Date;
}
