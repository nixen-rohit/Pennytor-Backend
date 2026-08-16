import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditAction, Prisma } from '@prisma/client';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fire-and-forget by design: an audit-log failure should never block
   * the user-facing operation it's recording. We log locally as a fallback
   * if the DB write itself fails.
   *
   * Finance decisions pass an interactive-transaction client so the audit
   * row commits atomically with the decision they record.
   */
  async log(
    params: {
      userId?: string;
      action: AuditAction;
      ipAddress?: string;
      userAgent?: string;
      metadata?: Prisma.InputJsonValue;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    try {
      const client = tx ?? this.prisma;
      await client.auditLog.create({
        data: {
          userId: params.userId,
          action: params.action,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          metadata: params.metadata,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log for action ${params.action}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
