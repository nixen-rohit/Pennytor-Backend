import { Injectable } from '@nestjs/common';
import { DepositService } from '../deposits/deposit.service';
import { WithdrawalService } from '../withdrawals/withdrawal.service';
import { InvestmentFundService } from '../investment-fund/investment-fund.service';
import { SIPForChildService } from '../sip-for-child/sip-for-child.service';
import { FixedDepositService } from '../fixed-deposit/fixed-deposit.service';
import { ReferralService } from '../referral/referral.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly deposits: DepositService,
    private readonly withdrawals: WithdrawalService,
    private readonly investmentFund: InvestmentFundService,
    private readonly sip: SIPForChildService,
    private readonly fd: FixedDepositService,
    private readonly referral: ReferralService,
  ) {}

  async getSummary(userId: string) {
    const [dep, wdr, fund, sipRes, fdRes, eligibility, stats, codeRes] =
      await Promise.all([
        this.deposits.myDeposits(userId),
        this.withdrawals.myWithdrawals(userId),
        this.investmentFund.myApplications(userId),
        this.sip.myApplications(userId),
        this.fd.myApplications(userId),
        this.referral.getMyEligibility(userId),
        this.referral.getMyStats(userId),
        this.referral.getMyCode(userId),
      ]);

    const fundItems = fund.items ?? [];
    const sipItems = sipRes.items ?? [];
    const fdItems = fdRes ?? [];

    const activeFund = fundItems.filter((i: any) => i.status === 'VERIFIED');
    const activeSip = sipItems.filter((i: any) => i.status === 'VERIFIED');
    const activeFd = fdItems.filter((i: any) => i.status === 'VERIFIED');

    const totalInvested =
      fundItems.reduce((s: number, i: any) => s + Number(i.amount || 0), 0) +
      sipItems.reduce((s: number, i: any) => s + Number(i.totalInvested || 0), 0) +
      fdItems.reduce((s: number, i: any) => s + Number(i.depositAmount || 0), 0);

    const activePlans = activeFund.length + activeSip.length + activeFd.length;

    const monthlyRoi =
      activeFund.reduce((s: number, i: any) => s + Number(i.monthlyRoi || 0), 0) +
      activeSip.reduce((s: number, i: any) => s + Number(i.monthlyRoi || 0), 0) +
      activeFd.reduce((s: number, i: any) => s + Number(i.emiAmount || 0), 0);

    const totalRoi =
      fundItems.reduce((s: number, i: any) => s + Number(i.totalRoiPaid || 0), 0) +
      sipItems.reduce((s: number, i: any) => s + Number(i.totalRoiPaid || 0), 0) +
      fdItems.reduce((s: number, i: any) => {
        const paid = (i.payouts ?? [])
          .filter((p: any) => p.status === 'PAID')
          .reduce((ps: number, p: any) => ps + Number(p.amount || 0), 0);
        return s + paid;
      }, 0);

    const recentTransactions = [
      ...(dep.items ?? []).map((d: any) => ({
        id: `CR-${d.id}`,
        activity: 'Deposit',
        status: d.status === 'VERIFIED' ? 'APPROVED' : d.status === 'REJECTED' ? 'REJECTED' : 'PENDING',
        amount: Number(d.amount) || 0,
        date: new Date(d.submittedAt ?? d.createdAt),
      })),
      ...(wdr.items ?? []).map((w: any) => ({
        id: `DR-${w.id}`,
        activity: 'Withdrawal',
        status: w.status === 'VERIFIED' ? 'APPROVED' : w.status === 'REJECTED' ? 'REJECTED' : 'PENDING',
        amount: Number(w.amount) || 0,
        date: new Date(w.submittedAt ?? w.createdAt),
      })),
      ...fundItems.map((i: any) => ({
        id: `IF-${i.id}`,
        activity: i.planLabel,
        status: i.status === 'VERIFIED' ? 'APPROVED' : i.status === 'REJECTED' ? 'REJECTED' : 'PENDING',
        amount: Number(i.amount) || 0,
        date: new Date(i.submittedAt ?? i.createdAt),
      })),
      ...sipItems.map((i: any) => ({
        id: `SIP-${i.id}`,
        activity: i.planLabel,
        status: i.status === 'VERIFIED' ? 'APPROVED' : i.status === 'REJECTED' ? 'REJECTED' : 'PENDING',
        amount: Number(i.totalInvested) || 0,
        date: new Date(i.submittedAt ?? i.createdAt),
      })),
      ...fdItems.map((i: any) => ({
        id: `FD-${i.id}`,
        activity: i.planId || 'Fixed Deposit',
        status: i.status === 'VERIFIED' ? 'APPROVED' : i.status === 'REJECTED' ? 'REJECTED' : 'PENDING',
        amount: Number(i.depositAmount) || 0,
        date: new Date(i.submittedAt ?? i.createdAt),
      })),
    ]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 5);

    return {
      wallet: { balance: dep.balance ?? '0' },
      referral: {
        canRefer: eligibility.canRefer,
        reason: eligibility.reason,
        referralCode: codeRes.referralCode,
        referralCodeStatus: codeRes.referralCodeStatus,
        kycStatus: eligibility.kycStatus,
        directReferrals: stats.directReferrals,
        verifiedDirectReferrals: stats.verifiedDirectReferrals,
        currentUnlockedLevel: stats.currentUnlockedLevel,
        rates: stats.rates,
        thresholds: stats.thresholds,
        maxDepth: stats.maxDepth,
        totalEarnings: stats.totalEarnings,
        monthlyEarnings: stats.monthlyEarnings,
      },
      investmentSummary: {
        totalInvested: totalInvested.toString(),
        activePlans,
        monthlyRoi: monthlyRoi.toString(),
        totalRoi: totalRoi.toString(),
        items: [
          ...fundItems.map((i: any) => ({
            id: i.id,
            planLabel: i.planLabel,
            amount: i.amount,
            monthlyRoi: i.monthlyRoi,
            totalRoiPaid: i.totalRoiPaid,
            status: i.status,
            href: '/investment/all-schemes/investment-fund/progress',
          })),
          ...sipItems.map((i: any) => ({
            id: i.id,
            planLabel: i.planLabel,
            amount: i.totalInvested,
            monthlyRoi: i.monthlyRoi,
            totalRoiPaid: i.totalRoiPaid,
            status: i.status,
            href: '/investment/all-schemes/sip-for-child/progress',
          })),
          ...fdItems.map((i: any) => ({
            id: i.id,
            planLabel: i.planId || 'Fixed Deposit',
            amount: i.depositAmount,
            monthlyRoi: i.emiAmount,
            totalRoiPaid: (i.payouts ?? [])
              .filter((p: any) => p.status === 'PAID')
              .reduce((ps: number, p: any) => ps + Number(p.amount || 0), 0)
              .toString(),
            status: i.status,
            href: '/investment/all-schemes/fixed-deposite/progress',
          })),
        ],
      },
      fixedDeposits: fdItems,
      sipInvestments: sipItems,
      userInvestments: fundItems,
      recentTransactions,
    };
  }
}
