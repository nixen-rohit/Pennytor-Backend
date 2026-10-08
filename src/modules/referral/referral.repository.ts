import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ReferralCodeStatus } from '@prisma/client';

/**
 * All DB access for the referral module is concentrated here so that
 * services stay free of Prisma query shapes and can be unit-tested with
 * a mock. The shape mirrors the patterns used by other modules in this
 * codebase (DepositRepository, InvestmentFundRepository, …).
 */
@Injectable()
export class ReferralRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Referral code lookup ──────────────────────────────────────────────

  /**
   * Find a user by their referral code. Returns `null` if the code does
   * not exist OR the user is an ADMIN. The caller must still re-check
   * `referralCodeStatus` and the eligibility service (spec §3, §4).
   *
   * We always explicitly check `role !== 'ADMIN'` here — never rely on
   * `referredById === null` to mean "not admin" (spec §1).
   */
  async findActiveReferrerByCode(code: string) {
    return this.prisma.user.findFirst({
      where: {
        referralCode: code,
        role: { not: 'ADMIN' },
        referralCodeStatus: ReferralCodeStatus.ACTIVE,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        userType: true,
        referralCode: true,
        referralCodeStatus: true,
        referredById: true,
        status: true,
      },
    });
  }

  /** Any user (regardless of status) by their code — for admin views only. */
  async findByCodeRaw(code: string) {
    return this.prisma.user.findUnique({
      where: { referralCode: code },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        referralCode: true,
        referralCodeStatus: true,
        status: true,
      },
    });
  }

  // ─── Direct relationships ──────────────────────────────────────────────

  async getDirectReferralUserIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.referralRelationship.findMany({
      where: { referrerId: userId },
      select: { referredUserId: true },
    });
    return rows.map((r) => r.referredUserId);
  }

  async countDirectReferrals(userId: string): Promise<number> {
    return this.prisma.referralRelationship.count({
      where: { referrerId: userId },
    });
  }

  /** Returns true if the user already has a referrer set (any state). */
  async hasReferredBy(referredUserId: string): Promise<boolean> {
    const row = await this.prisma.referralRelationship.findUnique({
      where: { referredUserId },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Walks UP the referral chain to detect a cycle. Returns true if
   * `candidateReferrerId` is — directly or indirectly — already
   * downstream of `referredUserId`, which would create a loop.
   */
  async wouldCreateCycle(
    candidateReferrerId: string,
    referredUserId: string,
  ): Promise<boolean> {
    if (candidateReferrerId === referredUserId) return true;

    let cursor: string | null = candidateReferrerId;
    const seen = new Set<string>();
    while (cursor) {
      if (seen.has(cursor)) return true; // existing cycle (defensive)
      seen.add(cursor);
      const rel: { referrerId: string } | null =
        await this.prisma.referralRelationship.findUnique({
          where: { referredUserId: cursor },
          select: { referrerId: true },
        });
      if (!rel) return false;
      if (rel.referrerId === referredUserId) return true;
      cursor = rel.referrerId;
    }
    return false;
  }

  // ─── Tree traversal (BFS, depth-limited, spec §25) ─────────────────────

  /**
   * Returns the referral tree for `userId` up to `maxDepth` levels deep.
   * Iterative BFS with one batched `findMany` per level — no N+1, no
   * unbounded recursion (spec §29). The level-1 nodes are returned
   * directly; each carries its `children` array up to the depth limit.
   */
  async getTreeBounded(
    userId: string,
    maxDepth: number,
  ): Promise<ReferralTreeNode[]> {
    if (maxDepth <= 0) return [];

    const select = {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      referralCode: true,
      referralCodeStatus: true,
      userType: true,
      createdAt: true,
      referredById: true,
    } as const;

    // Level 1 — direct referrals of `userId`.
    const level1Rows = await this.prisma.user.findMany({
      where: { referredById: userId },
      select,
      orderBy: { createdAt: 'asc' },
    });

    const byId = new Map<string, ReferralTreeNode>();
    const childrenOf = new Map<string, ReferralTreeNode[]>();

    for (const r of level1Rows) {
      const node: ReferralTreeNode = {
        id: r.id,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        referralCode: r.referralCode,
        referralCodeStatus: r.referralCodeStatus,
        userType: r.userType,
        createdAt: r.createdAt,
        depth: 1,
        children: [],
        totalCommission: '0',
      };
      byId.set(r.id, node);
    }

    // Walk deeper levels until we run out of depth or no children.
    let currentParentIds = level1Rows.map((r) => r.id);
    for (
      let depth = 2;
      depth <= maxDepth && currentParentIds.length > 0;
      depth++
    ) {
      const rows = await this.prisma.user.findMany({
        where: { referredById: { in: currentParentIds } },
        select,
        orderBy: { createdAt: 'asc' },
      });
      const nextParents: string[] = [];
      for (const r of rows) {
        const node: ReferralTreeNode = {
          id: r.id,
          firstName: r.firstName,
          lastName: r.lastName,
          email: r.email,
          referralCode: r.referralCode,
          referralCodeStatus: r.referralCodeStatus,
          userType: r.userType,
          createdAt: r.createdAt,
          depth,
          children: [],
        totalCommission: '0',
        };
        byId.set(r.id, node);
        const parentId = r.referredById!;
        const arr = childrenOf.get(parentId) ?? [];
        arr.push(node);
        childrenOf.set(parentId, arr);
        nextParents.push(r.id);
      }
      currentParentIds = nextParents;
    }

    // Attach children to each node.
    for (const node of byId.values()) {
      node.children = childrenOf.get(node.id) ?? [];
    }

    return level1Rows.map((r) => byId.get(r.id)!);
  }
}

export interface ReferralTreeNode {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  referralCode: string | null;
  referralCodeStatus: string | null;
  userType: string;
  createdAt: Date;
  depth: number;
  children: ReferralTreeNode[];
  totalCommission: string;
}
