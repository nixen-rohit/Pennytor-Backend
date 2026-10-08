import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';

const BREVO_SEND_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiKey: string;
  private readonly fromAddress: string;
  private readonly fromName: string;
  private readonly templateCache = new Map<
    string,
    handlebars.TemplateDelegate
  >();

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('BREVO_API_KEY')!;
    this.fromAddress = this.config.get<string>('MAIL_FROM')!;
    this.fromName = this.config.get<string>('MAIL_FROM_NAME', 'Pennytor');
  }

  async sendVerificationEmail(params: {
    to: string;
    firstName: string;
    otp: string;
    clientId?: string | null;
  }): Promise<void> {
    const html = this.renderTemplate('verify-email', {
      firstName: params.firstName,
      otp: params.otp,
      clientId: params.clientId,
      expiryMinutes: this.config.get<number>('OTP_EXPIRY_MINUTES', 5),
    });

    await this.send({
      to: params.to,
      subject: 'Verify your Pennytor account',
      html,
    });
  }

  async sendPasswordResetEmail(params: {
    to: string;
    firstName: string;
    token: string;
    email: string;
  }): Promise<void> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL')!;
    const resetLink = `${frontendUrl}/reset-password?token=${params.token}&email=${encodeURIComponent(params.email)}`;

    const html = this.renderTemplate('reset-password', {
      firstName: params.firstName,
      resetLink,
      expiryMinutes: 15,
    });

    await this.send({
      to: params.to,
      subject: 'Reset your Pennytor password',
      html,
    });
  }

  async sendAccountApprovedEmail(params: {
    to: string;
    firstName: string;
    clientId: string;
  }): Promise<void> {
    const html = this.renderTemplate('account-approved', {
      firstName: params.firstName,
      clientId: params.clientId,
      kycLink: `${this.config.get<string>('FRONTEND_URL')}/kyc`,
      year: new Date().getFullYear(),
    });
    await this.send({
      to: params.to,
      subject: '🎉 Your Pennytor PMS Account is Opened!',
      html,
    });
  }

  async sendKycOtpEmail(params: {
    to: string;
    firstName: string;
    otp: string;
  }): Promise<void> {
    const html = this.renderTemplate('kyc-otp', {
      firstName: params.firstName,
      otp: params.otp,
      expiryMinutes: this.config.get<number>('OTP_EXPIRY_MINUTES', 10),
      year: new Date().getFullYear(),
    });
    await this.send({
      to: params.to,
      subject: 'Your KYC Verification OTP — Pennytor',
      html,
    });
  }

  async sendWithdrawalOtpEmail(params: {
    to: string;
    firstName: string;
    otp: string;
  }): Promise<void> {
    const html = this.renderTemplate('withdrawal-otp', {
      firstName: params.firstName,
      otp: params.otp,
      expiryMinutes: this.config.get<number>('OTP_EXPIRY_MINUTES', 10),
      year: new Date().getFullYear(),
    });
    await this.send({
      to: params.to,
      subject: 'Your Withdrawal OTP — Pennytor',
      html,
    });
  }

  async sendInvestmentFundOtpEmail(params: {
    to: string;
    firstName: string;
    otp: string;
    scheme: string;
    investmentAmount: string;
    schemeRange?: string;
    lockInPeriod: string;
    roi: number;
  }): Promise<void> {
    const html = this.renderTemplate('investment-fund-otp', {
      firstName: params.firstName,
      otp: params.otp,
      scheme: params.scheme,
      investmentAmount: params.investmentAmount,
      schemeRange: params.schemeRange ?? '',
      lockInPeriod: params.lockInPeriod,
      roi: params.roi,
      expiryMinutes: this.config.get<number>('OTP_EXPIRY_MINUTES', 10),
      year: new Date().getFullYear(),
    });
    await this.send({
      to: params.to,
      subject: 'Your Investment Fund OTP — Pennytor',
      html,
    });
  }

  async sendKycApprovedEmail(params: {
    to: string;
    firstName: string;
    clientId: string;
  }): Promise<void> {
    const html = this.renderTemplate('kyc-approved', {
      firstName: params.firstName,
      clientId: params.clientId,
      dashboardLink: `${this.config.get<string>('FRONTEND_URL')}/dashboard`,
      year: new Date().getFullYear(),
    });
    await this.send({
      to: params.to,
      subject: "✅ KYC Approved — You're Ready to Invest!",
      html,
    });
  }

  async sendKycRejectedEmail(params: {
    to: string;
    firstName: string;
    clientId?: string | null;
    reason: string;
  }): Promise<void> {
    const html = this.renderTemplate('kyc-rejected', {
      firstName: params.firstName,
      clientId: params.clientId,
      reason: params.reason,
      kycLink: `${this.config.get<string>('FRONTEND_URL')}/account-kyc`,
      year: new Date().getFullYear(),
    });
    await this.send({
      to: params.to,
      subject: 'KYC Application Rejected — Action Required',
      html,
    });
  }

  async sendDepositApprovedEmail(params: {
    to: string;
    firstName: string;
    amount: string;
    walletBalance: string;
    depositDate: string;
  }): Promise<void> {
    const html = this.renderTemplate('deposit-approved', {
      firstName: params.firstName,
      amount: params.amount,
      walletBalance: params.walletBalance,
      depositDate: params.depositDate,
      investLink: `${this.config.get<string>('FRONTEND_URL')}/plans`,
      year: new Date().getFullYear(),
    });
    await this.send({
      to: params.to,
      subject: '💰 Your Deposit is Approved — Pennytor',
      html,
    });
  }

  async sendInvestmentConfirmedEmail(params: {
    to: string;
    firstName: string;
    planName: string;
    investmentAmount: string;
    lockInPeriod: string;
    annualReturn: string;
    expectedProfit: string;
    investmentDate: string;
    walletBalance: string;
  }): Promise<void> {
    const html = this.renderTemplate('investment-confirmed', {
      ...params,
      dashboardLink: `${this.config.get<string>('FRONTEND_URL')}/dashboard`,
      year: new Date().getFullYear(),
    });
    await this.send({
      to: params.to,
      subject: '📈 Investment Confirmed — Pennytor',
      html,
    });
  }

  /** Sent when an admin approves an investment fund application — a copy of
   * the review data: plan, amount, monthly ROI, cycle start / payout dates. */
  async sendInvestmentFundApprovedEmail(params: {
    to: string;
    firstName: string;
    planName: string;
    amount: string;
    monthlyRoi: string;
    roiPercent: string;
    lockInPeriod: string;
    cycleStartDate: string;
    nextPayoutDate: string;
    maturityDate: string;
  }): Promise<void> {
    const html = this.renderTemplate('investment-fund-approved', {
      ...params,
      dashboardLink: `${this.config.get<string>('FRONTEND_URL')}/dashboard`,
      year: new Date().getFullYear(),
    });
    await this.send({
      to: params.to,
      subject: '🚀 Investment Approved — Your ROI Cycle Has Started',
      html,
    });
  }

  /** OTP verification email for SIP For Child application. */
  async sendSipForChildOtpEmail(params: {
    to: string;
    firstName: string;
    otp: string;
    scheme: string;
    monthlyPremium: string;
    duration: string;
    annualReturn: number;
  }): Promise<void> {
    const html = this.renderTemplate('sip-for-child-otp', {
      firstName: params.firstName,
      otp: params.otp,
      scheme: params.scheme,
      monthlyPremium: params.monthlyPremium,
      duration: params.duration,
      annualReturn: params.annualReturn,
      expiryMinutes: this.config.get<number>('OTP_EXPIRY_MINUTES', 5),
      year: new Date().getFullYear(),
    });
    await this.send({
      to: params.to,
      subject: '🎓 SIP For Child Verification — Pennytor',
      html,
    });
  }

  /** Sent when admin approves a SIP For Child application. */
  async sendSipForChildApprovedEmail(params: {
    to: string;
    firstName: string;
    planName: string;
    monthlyPremium: string;
    duration: string;
    totalMonths: number;
    annualReturn: number;
    fundValue: string;
    cycleStartDate: string;
    firstPremiumDue: string;
    maturityDate: string;
  }): Promise<void> {
    const html = this.renderTemplate('sip-for-child-approved', {
      ...params,
      dashboardLink: `${this.config.get<string>('FRONTEND_URL')}/investment/all-schemes/sip-for-child/progress`,
      year: new Date().getFullYear(),
    });
    await this.send({
      to: params.to,
      subject: '🎓 SIP For Child Approved — Start Paying Premiums',
      html,
    });
  }

  /** Confirmation after each SIP For Child monthly premium is paid. */
  async sendSipForChildPremiumPaidEmail(params: {
    to: string;
    firstName: string;
    planName: string;
    amountPaid: string;
    monthNumber: number;
    totalMonths: number;
    paymentDate: string;
    isAdvance: boolean;
    totalPaid: string;
    monthsRemaining: number;
    nextPaymentDue: string;
    monthsPaid: number;
  }): Promise<void> {
    const progressPercent = Math.min(
      100,
      Math.round((params.monthsPaid / params.totalMonths) * 100),
    );
    const html = this.renderTemplate('sip-for-child-premium-paid', {
      ...params,
      progressPercent,
      dashboardLink: `${this.config.get<string>('FRONTEND_URL')}/investment/all-schemes/sip-for-child/progress`,
      year: new Date().getFullYear(),
    });
    await this.send({
      to: params.to,
      subject: `✅ SIP Premium ${params.monthNumber}/${params.totalMonths} Paid — Pennytor`,
      html,
    });
  }

  /** Sent when a SIP For Child monthly premium is missed. */
  async sendSipForChildMissedPaymentEmail(params: {
    to: string;
    firstName: string;
    planName: string;
    missedMonth: number;
    totalMonths: number;
    dueDate: string;
    monthlyPremium: string;
    monthsMissed: number;
  }): Promise<void> {
    const html = this.renderTemplate('sip-for-child-missed-payment', {
      ...params,
      dashboardLink: `${this.config.get<string>('FRONTEND_URL')}/investment/all-schemes/sip-for-child/progress`,
      year: new Date().getFullYear(),
    });
    await this.send({
      to: params.to,
      subject: '⚠️ SIP Premium Missed — Pay Now to Avoid Auto-Rejection',
      html,
    });
  }

  /** Sent when a SIP For Child is auto-rejected after 4 missed payments. */
  async sendSipForChildAutoRejectedEmail(params: {
    to: string;
    firstName: string;
    planName: string;
    monthsPaid: number;
    totalMonths: number;
    monthsMissed: number;
    refundAmount: string;
  }): Promise<void> {
    const html = this.renderTemplate('sip-for-child-auto-rejected', {
      ...params,
      dashboardLink: `${this.config.get<string>('FRONTEND_URL')}/investment/all-schemes/sip-for-child/progress`,
      year: new Date().getFullYear(),
    });
    await this.send({
      to: params.to,
      subject: '❌ SIP For Child Auto-Rejected — Full Refund Credited',
      html,
    });
  }

  // ─── Fixed Deposit Emails ────────────────────────────────────────────────

  async sendFDOTPEmail(
    to: string,
    otp: string,
    params: { firstName: string; planId: string; depositAmount: number },
  ) {
    const html = this.renderTemplate('fd-otp', {
      firstName: params.firstName,
      otp,
      expiryMinutes: this.config.get<number>('OTP_EXPIRY_MINUTES', 5),
      planId: params.planId,
      depositAmount: params.depositAmount.toLocaleString('en-IN'),
      year: new Date().getFullYear(),
    });
    await this.send({
      to,
      subject: '🏦 Fixed Deposit — OTP Verification',
      html,
    });
  }

  async sendFDAppliedEmail(
    to: string,
    params: {
      firstName: string;
      applicationId: string;
      planId: string;
      depositAmount: number;
      lockInMonths: number;
    },
  ) {
    const html = this.renderTemplate('fd-applied', {
      firstName: params.firstName,
      applicationId: params.applicationId,
      planId: params.planId,
      depositAmount: params.depositAmount.toLocaleString('en-IN'),
      lockInMonths: params.lockInMonths,
      year: new Date().getFullYear(),
    });
    await this.send({
      to,
      subject: '🏦 Fixed Deposit Application Submitted',
      html,
    });
  }

  async sendFDApprovedEmail(
    to: string,
    params: {
      firstName: string;
      applicationId: string;
      planId: string;
      depositAmount: number;
      lockInMonths: number;
      payoutMode: string;
      emiAmount: number;
      totalEmis: number;
      totalPayout: number;
      nextPayoutAt: Date | null;
    },
  ) {
    const html = this.renderTemplate('fd-approved', {
      firstName: params.firstName,
      applicationId: params.applicationId,
      planId: params.planId,
      depositAmount: params.depositAmount.toLocaleString('en-IN'),
      payoutMode: params.payoutMode,
      emiAmount: params.emiAmount.toLocaleString('en-IN'),
      totalEmis: params.totalEmis,
      totalPayout: params.totalPayout.toLocaleString('en-IN'),
      nextPayoutDate: params.nextPayoutAt
        ? new Date(params.nextPayoutAt).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })
        : 'N/A',
      year: new Date().getFullYear(),
    });
    await this.send({
      to,
      subject: '🏦 Fixed Deposit Approved — Payout Cycle Started',
      html,
    });
  }

  async sendFDEMICreditedEmail(
    to: string,
    params: {
      firstName: string;
      applicationId: string;
      planId: string;
      emiNumber: number;
      amount: number;
      newBalance: number;
    },
  ) {
    const html = this.renderTemplate('fd-emi-credited', {
      firstName: params.firstName,
      applicationId: params.applicationId,
      planId: params.planId,
      emiNumber: params.emiNumber,
      amount: params.amount.toLocaleString('en-IN'),
      newBalance: params.newBalance.toLocaleString('en-IN'),
      year: new Date().getFullYear(),
    });
    await this.send({ to, subject: '💸 Fixed Deposit EMI Credited', html });
  }

  async sendFDMaturedEmail(
    to: string,
    params: {
      firstName: string;
      applicationId: string;
      planId: string;
      totalPayout: number;
      depositAmount: number;
    },
  ) {
    const html = this.renderTemplate('fd-matured', {
      firstName: params.firstName,
      applicationId: params.applicationId,
      planId: params.planId,
      totalPayout: params.totalPayout.toLocaleString('en-IN'),
      depositAmount: params.depositAmount.toLocaleString('en-IN'),
      year: new Date().getFullYear(),
    });
    await this.send({
      to,
      subject: '🎉 Fixed Deposit Matured — Congratulations!',
      html,
    });
  }

  /**
   * Sends a Fixed Deposit rejection and refund email to the user.
   */
  async sendFDRejectedRefundEmail(params: {
    to: string;
    firstName: string;
    applicationId: string;
    reason: string;
    refundAmount: number;
    newBalance: number;
  }) {
    const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Fixed Deposit Application Rejected</h2>
      <p>Dear ${params.firstName},</p>
      <p>Your Fixed Deposit application (ID: ${params.applicationId}) has been rejected and a refund has been processed.</p>
      <p><strong>Refund Amount:</strong> $${params.refundAmount.toLocaleString('en-IN')}</p>
      <p><strong>New Wallet Balance:</strong> $${params.newBalance.toLocaleString('en-IN')}</p>
      <p>Reason: ${params.reason || 'Admin decision'}</p>
      <p>You can apply for a new Fixed Deposit once your KYC is verified.</p>
      <br/>
      <p>Best regards,<br/>Pennytor Team</p>
    </div>`;

    await this.send({
      to: params.to,
      subject: 'Fixed Deposit Application Rejected — Refund Processed',
      html,
    });
  }

  private async send(params: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    try {
      const response = await fetch(BREVO_SEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify({
          sender: { email: this.fromAddress, name: this.fromName },
          to: [{ email: params.to }],
          subject: params.subject,
          htmlContent: params.html,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Brevo API responded with ${response.status}: ${body}`);
      }
    } catch (error) {
      // Email failure should not silently vanish — but registration flow decides
      // whether to fail the request or let the user request a resend.
      this.logger.error(
        `Failed to send email to ${params.to}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  private renderTemplate(
    name: string,
    context: Record<string, unknown>,
  ): string {
    let template = this.templateCache.get(name);
    if (!template) {
      const source = readFileSync(
        join(__dirname, 'templates', `${name}.hbs`),
        'utf-8',
      );
      template = handlebars.compile(source);
      this.templateCache.set(name, template);
    }
    return template(context);
  }
}
