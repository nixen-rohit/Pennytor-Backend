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
    private send;
    private renderTemplate;
}
