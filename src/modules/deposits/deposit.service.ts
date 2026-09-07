import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import * as path from 'path';
import { DepositRequest, DepositStatus, Prisma } from '@prisma/client';
import { DepositRepository } from './deposit.repository';
import { KycService } from '../kyc/kyc.service';
import { CreateDepositDto } from './dto/create-deposit.dto';
import {
  EXTENSION_BY_KIND,
  MIME_BY_KIND,
  assertUploadSize,
  detectFileKind,
} from '../../common/utils/file-validation.util';
import {
  assertSafeStorageName,
  depositDir,
  depositRelativePath,
  resolvePrivatePath,
} from '../../common/utils/storage.util';

const SCREENSHOT_KINDS = new Set(['jpeg', 'png', 'webp']);

/** Maximum single deposit amount in INR. */
const MAX_DEPOSIT_AMOUNT = 500_000;

@Injectable()
export class DepositService {
  private readonly logger = new Logger(DepositService.name);
  private readonly storageRoot: string;
  private readonly maxFileBytes: number;

  constructor(
    private readonly repository: DepositRepository,
    private readonly kycService: KycService,
    config: ConfigService,
  ) {
    this.storageRoot = path.resolve(
      config.get<string>('PRIVATE_STORAGE_PATH', '/var/private-storage'),
    );
    this.maxFileBytes =
      Math.max(1, config.get<number>('DEPOSIT_UPLOAD_MAX_MB', 2)) * 1024 * 1024;
  }

  // ---------------------------------------------------------------- user

  /**
   * Creates a PENDING deposit request and persists the screenshot. The
   * request id is generated here so the disk directory matches the DB row.
   */
  async createDeposit(
    userId: string,
    dto: CreateDepositDto,
    buffer: Buffer,
    originalName: string,
  ): Promise<{ id: string; status: DepositStatus; amount: string }> {
    // Spec §9: only KYC-verified users may move money. Throws 403
    // with a human-readable reason; the front-end routes the user
    // to /account-kyc on receipt.
    await this.kycService.assertKycVerified(userId);

    const active = await this.repository.findActiveByUser(userId);
    if (active) {
      throw new ConflictException(
        'You already have an active deposit request. Please wait for it to be processed.',
      );
    }

    assertUploadSize(buffer.length, this.maxFileBytes);
    const kind = detectFileKind(buffer);
    if (!kind || !SCREENSHOT_KINDS.has(kind)) {
      throw new BadRequestException(
        'Screenshot must be a JPG, PNG or WebP image',
      );
    }

    const amountNum = parseFloat(dto.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new BadRequestException('Deposit amount must be greater than 0');
    }
    if (amountNum > MAX_DEPOSIT_AMOUNT) {
      throw new BadRequestException(
        `Deposit amount must not exceed ₹${MAX_DEPOSIT_AMOUNT.toLocaleString('en-IN')}`,
      );
    }

    const id = randomUUID();
    const storageName = `${randomUUID()}.${EXTENSION_BY_KIND[kind]}`;
    assertSafeStorageName(storageName);
    const relativePath = depositRelativePath(id, storageName);
    const absolutePath = resolvePrivatePath(this.storageRoot, relativePath);

    await fs.mkdir(depositDir(this.storageRoot, id), { recursive: true });
    await fs.writeFile(absolutePath, buffer, {
      mode: 0o600,
      flag: 'wx',
    });

    try {
      const created = await this.repository.create(userId, {
        id,
        amount: dto.amount,
        transactionId: dto.transactionId,
        originalName: originalName.slice(0, 255),
        storageName,
        storagePath: relativePath,
        mimeType: MIME_BY_KIND[kind],
        fileSize: buffer.length,
      });
      return {
        id: created.id,
        status: created.status,
        amount: created.amount.toString(),
      };
    } catch (error) {
      // DB failed after the file hit the disk — remove the orphan.
      await fs.unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  async myDeposits(userId: string) {
    const [rows, balance] = await Promise.all([
      this.repository.listMine(userId),
      this.repository.getBalance(userId),
    ]);
    return {
      balance,
      items: rows.map((r) => this.toUserView(r)),
    };
  }

  async getMyLatest(userId: string) {
    const active = await this.repository.findActiveByUser(userId);
    if (active) {
      return {
        hasActive: true,
        deposit: this.toUserView(active),
      };
    }

    const rows = await this.repository.listMine(userId);
    if (rows.length === 0) {
      return { hasActive: false, deposit: null };
    }

    const latest = rows[0];
    return {
      hasActive: false,
      deposit: this.toUserView(latest),
    };
  }

  async getDeposit(userId: string, id: string) {
    const row = await this.repository.findById(id);
    if (!row || row.userId !== userId) {
      throw new NotFoundException('Deposit request not found');
    }
    return {
      id: row.id,
      status: row.status,
      amount: row.amount.toString(),
      createdAt: row.createdAt,
      transactionId: row.transactionId,
      reviewNote: row.status === DepositStatus.REJECTED ? row.reviewNote : null,
    };
  }

  /** User-facing view — never storage paths or original names. */
  private toUserView(row: DepositRequest) {
    return {
      id: row.id,
      amount: row.amount.toString(),
      transactionId: row.transactionId,
      status: row.status,
      reviewNote: row.status === DepositStatus.REJECTED ? row.reviewNote : null,
      submittedAt: row.submittedAt,
      createdAt: row.createdAt,
    };
  }

  // ---------------------------------------------------------------- admin

  async listDeposits(query: {
    status?: DepositStatus;
    search?: string;
    page: number;
    pageSize: number;
  }) {
    return this.repository.list({
      status: query.status,
      search: query.search?.trim() || undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async getDepositDetail(id: string) {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException('Deposit request not found');
    return {
      id: row.id,
      clientId: row.user?.clientId ?? null,
      currentBalance: (row.user?.balance ?? new Prisma.Decimal(0)).toString(),
      amount: row.amount.toString(),
      transactionId: row.transactionId,
      status: row.status,
      reviewNote: row.reviewNote,
      submittedAt: row.submittedAt,
      reviewedAt: row.reviewedAt,
      createdAt: row.createdAt,
      user: row.user
        ? {
            firstName: row.user.firstName,
            lastName: row.user.lastName,
            email: row.user.email,
            clientId: row.user.clientId,
          }
        : null,
      file: {
        id: row.id,
        mimeType: row.mimeType,
        fileSize: row.fileSize,
        originalName: row.originalName,
      },
    };
  }

  /** Resolves a verified absolute path for admin streaming. */
  async resolveFile(id: string): Promise<{
    row: DepositRequest;
    absolutePath: string;
  }> {
    const row = await this.repository.findByIdPlain(id);
    if (!row) throw new NotFoundException('Deposit request not found');

    assertSafeStorageName(row.storageName);
    const absolutePath = resolvePrivatePath(this.storageRoot, row.storagePath);

    try {
      await fs.access(absolutePath);
    } catch {
      throw new NotFoundException('Screenshot is missing on the server');
    }

    return { row, absolutePath };
  }

  /** Admin view/download — streams with correct headers, never the path. */
  async streamFile(id: string): Promise<{
    row: DepositRequest;
    stream: ReturnType<typeof createReadStream>;
  }> {
    const { row, absolutePath } = await this.resolveFile(id);
    return { row, stream: createReadStream(absolutePath) };
  }

  /**
   * Approve a PENDING/UNDER_REVIEW deposit: atomic, race-safe (conditional
   * flip + credit + ledger + audit). Already-processed rows → 409.
   */
  async approve(id: string, adminId: string) {
    const row = await this.repository.findByIdPlain(id);
    if (!row) throw new NotFoundException('Deposit request not found');

    const { conflicted } = await this.repository.approve(row, adminId);
    if (conflicted) {
      throw new ConflictException(
        'Deposit already processed; only pending deposits can be approved',
      );
    }
    return { id, status: DepositStatus.VERIFIED };
  }

  /** Reject a PENDING/UNDER_REVIEW deposit with a reason (min 3 chars). */
  async reject(id: string, adminId: string, reason: string) {
    const clean = reason.trim();
    if (clean.length < 3) {
      throw new BadRequestException(
        'A rejection reason of at least 3 characters is required',
      );
    }
    const row = await this.repository.findByIdPlain(id);
    if (!row) throw new NotFoundException('Deposit request not found');

    const { conflicted } = await this.repository.reject(row, adminId, clean);
    if (conflicted) {
      throw new ConflictException(
        'Deposit already processed; only pending deposits can be rejected',
      );
    }
    return { id, status: DepositStatus.REJECTED };
  }
}
