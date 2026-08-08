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
  }): Promise<void> {
    const html = this.renderTemplate('verify-email', {
      firstName: params.firstName,
      otp: params.otp,
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
