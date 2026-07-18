import { PrismaService } from '../../database/prisma.service';
import { AuditAction, Prisma } from '@prisma/client';
export declare class AuditService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    log(params: {
        userId?: string;
        action: AuditAction;
        ipAddress?: string;
        userAgent?: string;
        metadata?: Prisma.InputJsonValue;
    }): Promise<void>;
}
