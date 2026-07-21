import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
export declare class RefreshTokenService {
    private readonly prisma;
    private readonly config;
    private readonly auditService;
    private readonly logger;
    private readonly expiryDays;
    constructor(prisma: PrismaService, config: ConfigService, auditService: AuditService);
    create(userId: string, ctx: {
        ipAddress?: string;
        userAgent?: string;
    }): Promise<string>;
    validateAndRotate(rawToken: string, ctx: {
        ipAddress?: string;
        userAgent?: string;
    }): Promise<{
        rawToken: string;
        userId: string;
    }>;
    private handleTheftDetection;
    revoke(rawToken: string): Promise<void>;
    revokeAllForUser(userId: string): Promise<void>;
    private static hashToken;
}
