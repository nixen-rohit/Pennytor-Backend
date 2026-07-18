import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { OtpPurpose } from '@prisma/client';
export declare class OtpService {
    private readonly prisma;
    private readonly config;
    private readonly expiryMinutes;
    private readonly maxAttempts;
    private readonly length;
    private readonly saltRounds;
    constructor(prisma: PrismaService, config: ConfigService);
    generate(userId: string, purpose: OtpPurpose): Promise<string>;
    verify(userId: string, purpose: OtpPurpose, submittedOtp: string): Promise<void>;
    private generateNumericCode;
}
