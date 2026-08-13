import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import * as path from 'path';
import { KycFile, KycFileAuditAction, KycFileType } from '@prisma/client';
import { KycRepository } from './kyc.repository';
import {
  EXTENSION_BY_KIND,
  MIME_BY_KIND,
  assertUploadSize,
  validateFileContent,
} from '../../common/utils/file-validation.util';
import {
  applicationDir,
  assertSafeStorageName,
  kycRelativePath,
  resolvePrivatePath,
} from '../../common/utils/storage.util';
/**
 * Owns the physical-file lifecycle on the VPS filesystem and keeps it
 * consistent with the metadata rows in PostgreSQL.
 *
 * Write order is deliberately: validate content → write file → insert
 * metadata. If the DB insert fails, the freshly written file is removed so
 * no orphan accumulates. Deletion is: remove physical file → delete row,
 * with the row left behind when the physical delete succeeds but the DB
 * write fails — reconciliation treats it as "metadata without a file".
 */
@Injectable()
export class KycFileService {
  private readonly logger = new Logger(KycFileService.name);
  private readonly storageRoot: string;
  private readonly maxFileBytes: number;

  constructor(
    private readonly repository: KycRepository,
    config: ConfigService,
  ) {
    this.storageRoot = path.resolve(
      config.get<string>('PRIVATE_STORAGE_PATH', '/var/private-storage'),
    );
    this.maxFileBytes =
      Math.max(1, config.get<number>('KYC_UPLOAD_MAX_MB', 2)) * 1024 * 1024;
  }

  /**
   * Validates, stores and records one uploaded document.
   *
   * @returns the fresh metadata row. On `replace` mode, the previous
   * physical file + row for the same type are removed first.
   */
  async storeFile(params: {
    applicationId: string;
    type: KycFileType;
    buffer: Buffer;
    originalName: string;
  }): Promise<KycFile> {
    const { applicationId, type, buffer, originalName } = params;

    assertUploadSize(buffer.length, this.maxFileBytes);
    const kind = validateFileContent(buffer, type);
    if (!kind) {
      throw new BadRequestException(
        `File content does not match an allowed format for ${type}. ` +
          'Send JPG/PNG/WebP images (PDF allowed for documents).',
      );
    }

    // Replace semantics: one file per type per application. Remove the old
    // physical copy + row before storing the new one.
    const existing = await this.repository.findFileByType(applicationId, type);
    if (existing) {
      await this.removePhysicalFile(existing);
      await this.repository.deleteFile(existing.id);
    }

    const storageName = `${randomUUID()}.${EXTENSION_BY_KIND[kind]}`;
    assertSafeStorageName(storageName);
    const relativePath = kycRelativePath(applicationId, storageName);
    const absolutePath = resolvePrivatePath(this.storageRoot, relativePath);

    await fs.mkdir(applicationDir(this.storageRoot, applicationId), {
      recursive: true,
    });
    await fs.writeFile(absolutePath, buffer, {
      mode: 0o600,
      flag: 'wx', // never overwrite an existing file with the same random name
    });

    try {
      return await this.repository.createFile({
        applicationId,
        type,
        originalName: originalName.slice(0, 255),
        storageName,
        storagePath: relativePath,
        mimeType: MIME_BY_KIND[kind],
        fileSize: buffer.length,
      });
    } catch (error) {
      // DB failed after the file hit the disk — remove the orphan and surface
      // the original error. Never return partial success.
      await this.removePhysicalFileByPath(absolutePath);
      throw error;
    }
  }

  /** Resolves metadata + a verified absolute path for admin streaming. */
  async resolveForAccess(
    applicationId: string,
    fileId: string,
  ): Promise<{ file: KycFile; absolutePath: string }> {
    const file = await this.repository.findFileForApplication(
      applicationId,
      fileId,
    );
    if (!file) {
      throw new NotFoundException('File not found');
    }

    assertSafeStorageName(file.storageName);
    const absolutePath = resolvePrivatePath(this.storageRoot, file.storagePath);

    try {
      await fs.access(absolutePath);
    } catch {
      throw new NotFoundException('File is missing on the server');
    }

    return { file, absolutePath };
  }

  /** Admin view/download — streams with correct headers, never the path. */
  async streamFile(
    applicationId: string,
    fileId: string,
  ): Promise<{ file: KycFile; stream: ReturnType<typeof createReadStream> }> {
    const { file, absolutePath } = await this.resolveForAccess(
      applicationId,
      fileId,
    );
    return { file, stream: createReadStream(absolutePath) };
  }

  /**
   * Admin delete: remove the physical file first, audit the DELETE (while the
   * metadata row still exists so the FK resolves), then delete the metadata
   * row. The audit row survives thanks to its snapshot columns + SetNull FK.
   * A missing physical file is not an error (treat as already-gone row),
   * but a failed DB delete leaves an orphaned row that reconciliation will
   * pick up — the error is logged, not swallowed.
   */
  async deleteFile(params: {
    applicationId: string;
    fileId: string;
    adminId: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    const { applicationId, fileId } = params;
    const file = await this.repository.findFileForApplication(
      applicationId,
      fileId,
    );
    if (!file) {
      throw new NotFoundException('File not found');
    }

    assertSafeStorageName(file.storageName);
    const absolutePath = resolvePrivatePath(this.storageRoot, file.storagePath);

    try {
      await fs.unlink(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      // ENOENT: physical file already gone — safe to continue.
    }

    await this.auditAction({
      fileId: file.id,
      fileType: file.type,
      storagePath: file.storagePath,
      adminId: params.adminId,
      action: KycFileAuditAction.DELETE,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });

    try {
      await this.repository.deleteFile(file.id);
    } catch (error) {
      this.logger.error(
        `Physical file removed but metadata delete failed for ${file.id}; reconciliation will clean it up.`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Records a VIEW/DOWNLOAD/DELETE audit entry for a private file.
   * Fail-safe by design: an audit write failure must never block the file
   * access itself — the event is logged locally instead.
   */
  async auditAction(params: {
    fileId: string;
    fileType: KycFileType;
    storagePath: string;
    adminId: string;
    action: KycFileAuditAction;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      await this.repository.createFileAudit(params);
    } catch (error) {
      this.logger.error(
        `Failed to write KYC file audit for ${params.action} on ${params.fileId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async removePhysicalFile(file: KycFile): Promise<void> {
    assertSafeStorageName(file.storageName);
    const absolutePath = resolvePrivatePath(this.storageRoot, file.storagePath);
    await this.removePhysicalFileByPath(absolutePath);
  }

  private async removePhysicalFileByPath(absolutePath: string): Promise<void> {
    try {
      await fs.unlink(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.error(
          `Failed to remove orphaned file at ${absolutePath}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
}
