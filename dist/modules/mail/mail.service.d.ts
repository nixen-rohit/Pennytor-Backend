import { ConfigService } from '@nestjs/config';
export declare class MailService {
    private readonly config;
    private readonly logger;
    private readonly apiKey;
    private readonly fromAddress;
    private readonly fromName;
    private readonly templateCache;
    constructor(config: ConfigService);
    sendVerificationEmail(params: {
        to: string;
        firstName: string;
        otp: string;
    }): Promise<void>;
    sendPasswordResetEmail(params: {
        to: string;
        firstName: string;
        token: string;
        email: string;
    }): Promise<void>;
    sendAccountApprovedEmail(params: {
        to: string;
        firstName: string;
        clientId: string;
    }): Promise<void>;
    sendKycOtpEmail(params: {
        to: string;
        firstName: string;
        otp: string;
    }): Promise<void>;
    sendKycApprovedEmail(params: {
        to: string;
        firstName: string;
        clientId: string;
    }): Promise<void>;
    sendDepositApprovedEmail(params: {
        to: string;
        firstName: string;
        amount: string;
        walletBalance: string;
        depositDate: string;
    }): Promise<void>;
    sendInvestmentConfirmedEmail(params: {
        to: string;
        firstName: string;
        planName: string;
        investmentAmount: string;
        lockInPeriod: string;
        annualReturn: string;
        expectedProfit: string;
        investmentDate: string;
        walletBalance: string;
    }): Promise<void>;
    private send;
    private renderTemplate;
}
