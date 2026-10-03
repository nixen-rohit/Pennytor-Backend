import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  InvestmentStatus,
  SIPStatus,
  FixedDepositStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CommissionConfigService } from './commission-config.service';
import { CommissionService } from './commission.service';
import { InvestmentEligibilityService } from './investment-eligibility.service';
import { AuditService } from '../audit/audit.service';

/**
 * Spec §16, §17, §18: the monthly commission scheduler.
 *
 *  - One generic job, NOT one per level.
 *  - Eligibility is snapshotted per referrer at the START of the cycle.
 *  - Tree traversal is iterative BFS up to maxDepth (spec §29).
 *  - Each commission insert is wrapped in a DB transaction with the
 *    wallet credit + ledger entry (spec §18). The unique constraint
 *    on the commission row is the final guard against duplicates
 *    (spec §17).
 *  - Asia/Kolkata is the business timezone (spec §28). The cycle is
 *    the previous calendar month in IST.
 *
 * The job is invoked by a NestJS cron in `commission-cron.service.ts`
 * and may also be triggered manually by an admin (see Admin endpoint
 * `POST /admin/commissions/run`).
 */
@Injectable()
export class CommissionSchedulerService {
  private readonly logger = new Logger(CommissionSchedulerService.name);
  private static readonly IST_OFFSET_MIN = 330; // UTC+5:30
  // Spec §17 idempotency layer 1: a process-level flag prevents two
  // concurrent runs from doubling up. The DB-level unique constraint
  // is the second layer; this is the first.
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: CommissionConfigService,
    private readonly commissions: CommissionService,
    private readonly eligibility: InvestmentEligibilityService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Returns the (month, year) of the most recent fully-elapsed calendar
   * month in Asia/Kolkata. If the caller passes a date, that date is
   * used to compute the period (lets admin runs target a specific month
   * for reprocessing).
   */
  periodForIST(date: Date = new Date()): { month: number; year: number } {
    const istMs =
      date.getTime() + CommissionSchedulerService.IST_OFFSET_MIN * 60_000;
    const ist = new Date(istMs);
    // The cycle is the PREVIOUS calendar month in IST — the most recent
    // fully-elapsed month. Running on the 2nd of a month therefore
    // processes the month that just ended, not the one just started.
    const prev = new Date(
      Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1),
    );
    return { month: prev.getUTCMonth() + 1, year: prev.getUTCFullYear() };
  }

  /**
   * Runs the full monthly commission cycle. Returns aggregate counters
   * for the audit log / dashboard. If a cycle is already in progress,
   * returns a "skipped" result without touching the database — the
   * combination of the in-process flag + the DB unique constraint
   * (spec §17) is sufficient to make retries safe.
   */
  async runCycle(opts?: { month?: number; year?: number; actorId?: string }) {
    if (this.isRunning) {
      this.logger.warn(
        'Commission cycle already in progress — skipping concurrent run (spec §17 idempotency)',
      );
      return {
        skipped: true,
        reason: 'A commission cycle is already in progress.',
        month: 0,
        year: 0,
        referrersScanned: 0,
        eligibleReferrers: 0,
        commissionsCreated: 0,
        errors: 0,
      };
    }
    this.isRunning = true;
    try {
      return await this.runCycleInner(opts);
    } finally {
      this.isRunning = false;
    }
  }

  private async runCycleInner(opts?: {
    month?: number;
    year?: number;
    actorId?: string;
  }) {
    const { month, year } =
      opts?.month && opts?.year
        ? { month: opts.month, year: opts.year }
        : this.periodForIST();

    const cfg = await this.config.get();
    const maxDepth = cfg.maxDepth;

    const result = {
      month,
      year,
      referrersScanned: 0,
      eligibleReferrers: 0,
      commissionsCreated: 0,
      errors: 0,
    };

    // Stream every USER (not ADMIN) user once, in id order. For a
    // typical Pennytor user table (hundreds of thousands), this still
    // fits comfortably in memory; if it ever grows past that, switch
    // to a cursor-based scan.
    const referrers = await this.prisma.user.findMany({
      where: {
        role: { not: Role.ADMIN },
        status: { not: 'DELETED' },
        // Only consider users who actually have a code — i.e. have been
        // through investment verification at least once. This excludes
        // freshly-registered accounts that have not invested yet.
        referralCode: { not: null },
      },
      select: { id: true },
    });
    result.referrersScanned = referrers.length;

    for (const { id: referrerId } of referrers) {
      try {
        const eligible =
          await this.eligibility.hasQualifyingActiveInvestment(referrerId);
        if (!eligible) continue;
        result.eligibleReferrers += 1;

        const verifiedDirect =
          await this.eligibility.countVerifiedDirectReferrals(referrerId);
        const unlockedLevel =
          await this.config.maxUnlockedLevel(verifiedDirect);
        if (unlockedLevel <= 0) continue;

        // BFS to L1..LmaxDepth.
        for (
          let level = 1;
          level <= Math.min(unlockedLevel, maxDepth);
          level++
        ) {
          const referredIds = await this.usersAtDepth(referrerId, level);
          for (const referredId of referredIds) {
            // Pull every qualifying investment of the referred user for
            // this cycle.
            const investments = await this.qualifyingInvestmentsFor(
              referredId,
              month,
              year,
            );
            for (const inv of investments) {
              const created = await this.commissions.calculateAndRecord({
                referrerId,
                referredUserId: referredId,
                investmentId: inv.id,
                investmentAmount: inv.amount,
                level,
                commissionMonth: month,
                commissionYear: year,
              });
              if (created) result.commissionsCreated += 1;
            }
          }
        }
      } catch (e) {
        result.errors += 1;
        this.logger.error(
          `Scheduler: referrer ${referrerId} failed: ${(e as Error).message}`,
          (e as Error).stack,
        );
      }
    }

    await this.audit.log({
      userId: opts?.actorId,
      action: 'REFERRAL_COMMISSION_CALCULATED',
      metadata: {
        ...result,
      },
    });

    this.logger.log(
      `Commission cycle ${year}-${String(month).padStart(2, '0')}: ` +
        `referrers=${result.referrersScanned} eligible=${result.eligibleReferrers} ` +
        `created=${result.commissionsCreated} errors=${result.errors}`,
    );
    return result;
  }

  /**
   * BFS: returns the userIds exactly `depth` levels under `rootId`.
   * depth=1 → direct referrals; depth=2 → their referrals; etc.
   * Bounded by `maxDepth` (spec §29) — this method ASSUMES the caller
   * has already enforced the bound; we still cap defensively at 10.
   */
  private async usersAtDepth(rootId: string, depth: number): Promise<string[]> {
    if (depth <= 0) return [];
    const cap = 10;
    const target = Math.min(depth, cap);

    let frontier: string[] = [rootId];
    let next: string[] = [];
    for (let d = 1; d <= target; d++) {
      if (frontier.length === 0) return [];
      const rows = await this.prisma.referralRelationship.findMany({
        where: { referrerId: { in: frontier } },
        select: { referredUserId: true },
      });
      next = rows.map((r) => r.referredUserId);
      if (d === target) return next;
      frontier = next;
      next = [];
    }
    return [];
  }

  /**
   * [start, end) UTC instants bounding the calendar month `month`/`year`,
   * interpreted in the business timezone (Asia/Kolkata). Prisma stores
   * DateTime in UTC, so we convert the IST midnight boundaries to UTC by
   * subtracting the fixed +5:30 offset.
   */
  private cycleRangeIST(
    month: number,
    year: number,
  ): { start: Date; end: Date } {
    const offsetMs = CommissionSchedulerService.IST_OFFSET_MIN * 60_000;
    // First-of-month at 00:00 IST → UTC.
    const startUTC = Date.UTC(year, month - 1, 1, 0, 0, 0) - offsetMs;
    // First-of-next-month at 00:00 IST → UTC (exclusive end).
    const endUTC = Date.UTC(year, month, 1, 0, 0, 0) - offsetMs;
    return { start: new Date(startUTC), end: new Date(endUTC) };
  }

  /**
   * Returns every "qualifying investment" of the user for the given cycle.
   * Per spec §14 + §15:
   *  - Investment Fund: a VERIFIED application is one qualifying event.
   *  - Fixed Deposit: a VERIFIED FD application is one event.
   *  - SIP: each PAID premium whose `paidAt` falls inside the cycle month
   *    (IST) is one event, computed on the ACTUAL premium amount paid —
   *    NOT the SIP plan amount. A missed premium therefore produces no
   *    commission for that period.
   *
   * The returned `id` is stable per event (application id for Fund/FD,
   * premium id for SIP) and is used as the commission idempotency key, so
   * each paid premium yields at most one commission per level per cycle.
   */
  private async qualifyingInvestmentsFor(
    userId: string,
    month: number,
    year: number,
  ): Promise<
    Array<{ id: string; amount: Prisma.Decimal; kind: 'FUND' | 'FD' | 'SIP' }>
  > {
    const { start, end } = this.cycleRangeIST(month, year);
    const [funds, fds, sipPremiums] = await Promise.all([
      this.prisma.investmentApplication.findMany({
        where: { userId, status: InvestmentStatus.VERIFIED },
        select: { id: true, amount: true },
      }),
      this.prisma.fixedDepositApplication.findMany({
        where: { userId, status: FixedDepositStatus.VERIFIED },
        select: { id: true, depositAmount: true },
      }),
      this.prisma.sIPForChildPremium.findMany({
        where: {
          userId,
          status: 'PAID',
          paidAt: { gte: start, lt: end },
          application: { status: SIPStatus.VERIFIED },
        },
        select: { id: true, amount: true },
      }),
    ]);

    const out: Array<{
      id: string;
      amount: Prisma.Decimal;
      kind: 'FUND' | 'FD' | 'SIP';
    }> = [];
    for (const f of funds)
      out.push({ id: f.id, amount: f.amount, kind: 'FUND' });
    for (const fd of fds)
      out.push({ id: fd.id, amount: fd.depositAmount, kind: 'FD' });
    for (const p of sipPremiums)
      out.push({ id: p.id, amount: p.amount, kind: 'SIP' });
    return out;
  }
}
