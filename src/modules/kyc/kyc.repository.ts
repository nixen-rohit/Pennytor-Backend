import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  KycApplication,
  KycApplicationStatus,
  KycFile,
  KycFileAuditAction,
  KycFileType,
  Prisma,
} from '@prisma/client';

/**
 * Data-access layer for KYC. All queries live here so the service layer
 * stays free of Prisma details. Sensitive fields are read in their raw
 * (encrypted) form and only decrypted by the service layer on demand.
 */
@Injectable()
export class KycRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<KycApplication | null> {
    return this.prisma.kycApplication.findUnique({ where: { id } });
  }

  async findByUserId(userId: string): Promise<KycApplication | null> {
    return this.prisma.kycApplication.findUnique({ where: { userId } });
  }

  async findUserForApplication(applicationId: string) {
    const app = await this.prisma.kycApplication.findUnique({
      where: { id: applicationId },
      select: {
        user: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
            clientId: true,
          },
        },
      },
    });
    return app?.user ?? null;
  }

  /** Full detail with the file metadata rows attached. */
  async findDetail(id: string): Promise<Prisma.KycApplicationGetPayload<{
    include: {
      files: true;
      user: { select: { clientId: true } };
    };
  }> | null> {
    return this.prisma.kycApplication.findUnique({
      where: { id },
      include: {
        files: { orderBy: { createdAt: 'asc' } },
        user: { select: { clientId: true } },
      },
    });
  }

  async upsert(
    userId: string,
    data: Prisma.KycApplicationUncheckedCreateWithoutUserInput,
  ): Promise<KycApplication> {
    return this.prisma.kycApplication.upsert({
      where: { userId },
      create: { ...data, userId },
      update: {
        ...data,
        // A fresh submission cycle starts unsubmitted, but the previous
        // admin decision (reviewedAt / reviewedBy / reviewNote) is KEPT so
        // reviewers can see what happened last time the user was reviewed.
        submittedAt: null,
      },
    });
  }

  async list(params: {
    status?: KycApplicationStatus;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: KycApplication[]; total: number }> {
    const where: Prisma.KycApplicationWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.search
        ? {
            OR: [
              {
                user: {
                  email: { contains: params.search, mode: 'insensitive' },
                },
              },
              {
                user: {
                  clientId: { contains: params.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.kycApplication.findMany({
        where,
        include: {
          user: {
            select: {
              email: true,
              clientId: true,
            },
          },
          _count: { select: { files: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.kycApplication.count({ where }),
    ]);

    return { items, total };
  }

  async setStatus(
    id: string,
    status: KycApplicationStatus,
    reviewedBy: string,
    note?: string | null,
  ): Promise<KycApplication> {
    return this.prisma.kycApplication.update({
      where: { id },
      data: {
        status,
        reviewedBy,
        reviewedAt: new Date(),
        ...(note !== undefined ? { reviewNote: note } : {}),
      },
    });
  }

  async markSubmitted(id: string): Promise<KycApplication> {
    return this.prisma.kycApplication.update({
      where: { id },
      data: { status: KycApplicationStatus.SUBMITTED, submittedAt: new Date() },
    });
  }

  // ---- Files ----

  async findFile(
    id: string,
  ): Promise<(KycFile & { application: KycApplication }) | null> {
    return this.prisma.kycFile.findUnique({
      where: { id },
      include: { application: true },
    });
  }

  async findFileForApplication(
    applicationId: string,
    fileId: string,
  ): Promise<KycFile | null> {
    return this.prisma.kycFile.findUnique({
      where: { id: fileId, applicationId },
    });
  }

  async listFiles(applicationId: string): Promise<KycFile[]> {
    return this.prisma.kycFile.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async countFiles(applicationId: string): Promise<number> {
    return this.prisma.kycFile.count({ where: { applicationId } });
  }

  /**
   * Creates the metadata row for a stored file. With the @@unique
   * [applicationId, type] constraint, re-uploading a type throws P2002 —
   * the caller then replaces the existing row + physical file instead.
   */
  async createFile(data: {
    applicationId: string;
    type: KycFileType;
    originalName: string;
    storageName: string;
    storagePath: string;
    mimeType: string;
    fileSize: number;
  }): Promise<KycFile> {
    return this.prisma.kycFile.create({ data });
  }

  async findFileByType(
    applicationId: string,
    type: KycFileType,
  ): Promise<KycFile | null> {
    return this.prisma.kycFile.findUnique({
      where: { applicationId_type: { applicationId, type } },
    });
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.prisma.kycFile.delete({ where: { id: fileId } });
  }

  // ---- File audit ----

  async createFileAudit(params: {
    fileId: string;
    fileType: KycFileType;
    storagePath: string;
    adminId: string;
    action: KycFileAuditAction;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.prisma.kycFileAuditLog.create({ data: params });
  }

  async listFileAudits(fileId: string, limit = 50) {
    return this.prisma.kycFileAuditLog.findMany({
      where: { fileId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
