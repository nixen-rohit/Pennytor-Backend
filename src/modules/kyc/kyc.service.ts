import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { KycApplicationStatus, KycFileType, OtpPurpose } from '@prisma/client';
import { KycRepository } from './kyc.repository';
import { KycFileService } from './kyc.file.service';
import { EncryptionService } from '../../common/services/encryption.service';
import { OtpService } from '../otp/otp.service';
import { MailService } from '../mail/mail.service';
import { CreateKycApplicationDto } from './dto/create-kyc-application.dto';
import { ListApplicationsQueryDto } from './dto/list-applications-query.dto';
import {
  ACCOUNT_TYPE_TO_ENUM,
  GENDER_TO_ENUM,
  MARITAL_STATUS_TO_ENUM,
} from './kyc.types';
import { toUtcDateOnly } from './kyc.date';

const REQUIRED_FILE_TYPES: KycFileType[] = [
  KycFileType.SELFIE,
  KycFileType.AADHAAR_FRONT,
  KycFileType.AADHAAR_BACK,
  KycFileType.PAN,
  KycFileType.SIGNATURE,
];

/** Masked display value for an identifier's last 4 digits, e.g. `********1234`. */
function mask(last4: string): string {
  return `${'*'.repeat(Math.max(4, last4.length))}${last4}`;
}

/**
 * Orchestrates the KYC application lifecycle.
 *
 * Identifier fields (aadhaar, PAN, account, IFSC, nominee aadhaar) are
 * AES-256-GCM ciphertext at rest. The ciphertext is decrypted ONLY for an
 * ADMIN in the review detail — verification needs the full numbers to
 * compare against the uploaded documents. Users and every other endpoint
 * see only the last-4 mask. Nothing sensitive is ever logged.
 */
@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private readonly repository: KycRepository,
    private readonly fileService: KycFileService,
    private readonly encryption: EncryptionService,
    private readonly otpService: OtpService,
    private readonly mailService: MailService,
  ) {}

  // ------------------------------------------------------------------ user

  /** Creates or updates the caller's application as a DRAFT. */
  async createApplication(userId: string, dto: CreateKycApplicationDto) {
    const data = {
      fullName: dto.fullName,
      phone: dto.phone,
      dob: toUtcDateOnly(dto.dob),
      gender: dto.gender ? GENDER_TO_ENUM[dto.gender] : null,
      maritalStatus: dto.maritalStatus
        ? MARITAL_STATUS_TO_ENUM[dto.maritalStatus]
        : null,
      aadhaarNumberEncrypted: this.encryption.encrypt(dto.aadhaarNumber),
      aadhaarNumberLast4: dto.aadhaarNumber.slice(-4),
      panNumberEncrypted: this.encryption.encrypt(dto.panNumber),
      panNumberLast4: dto.panNumber.slice(-4),
      accountHolderName: dto.accountHolderName,
      accountNumberEncrypted: this.encryption.encrypt(dto.accountNumber),
      accountNumberLast4: dto.accountNumber.slice(-4),
      ifscCodeEncrypted: this.encryption.encrypt(dto.ifscCode),
      ifscCodeLast4: dto.ifscCode.slice(-4),
      bankName: dto.bankName,
      branchName: dto.branchName,
      accountType: dto.accountType
        ? ACCOUNT_TYPE_TO_ENUM[dto.accountType]
        : null,
      branchAddress: dto.branchAddress?.trim() || null,
      nomineeName: dto.nomineeName,
      nomineeDob: toUtcDateOnly(dto.nomineeDob),
      nomineePhone: dto.nomineePhone?.trim() || null,
      // Optional: NULL when the applicant leaves the nominee Aadhaar blank.
      nomineeAadhaarEncrypted: dto.nomineeAadhaar?.trim()
        ? this.encryption.encrypt(dto.nomineeAadhaar.trim())
        : null,
      nomineeAadhaarLast4: dto.nomineeAadhaar?.trim()
        ? dto.nomineeAadhaar.trim().slice(-4)
        : null,
    };

    const app = await this.repository.upsert(userId, data);
    return { id: app.id, status: app.status };
  }

  /**
   * Caller's own application — full details (decrypted for the OWNER, it is
   * their own data), file metadata as types only. Never storage paths.
   */
  async getMyApplication(userId: string) {
    const app = await this.repository.findByUserId(userId);
    if (!app) return null;
    const files = await this.repository.listFiles(app.id);
    return {
      id: app.id,
      status: app.status,
      // Only the rejection reason is exposed, and only when REJECTED.
      rejectionReason:
        app.status === KycApplicationStatus.REJECTED ? app.reviewNote : null,
      personal: {
        fullName: app.fullName,
        phone: app.phone,
        dob: app.dob,
        gender: app.gender,
        maritalStatus: app.maritalStatus,
      },
      documents: {
        // The OWNER sees their own full identifiers — a draft/rejected
        // application must be editable without forcing re-entry. Rows
        // created before the encrypted layer fall back to the last-4 mask.
        aadhaarNumber:
          this.decryptOrNull(app.aadhaarNumberEncrypted, app.id) ??
          mask(app.aadhaarNumberLast4),
        panNumber:
          this.decryptOrNull(app.panNumberEncrypted, app.id) ??
          mask(app.panNumberLast4),
      },
      bank: {
        accountHolderName: app.accountHolderName,
        accountNumber:
          this.decryptOrNull(app.accountNumberEncrypted, app.id) ??
          mask(app.accountNumberLast4),
        ifscCode:
          this.decryptOrNull(app.ifscCodeEncrypted, app.id) ??
          mask(app.ifscCodeLast4),
        bankName: app.bankName,
        branchName: app.branchName,
        accountType: app.accountType,
        branchAddress: app.branchAddress,
      },
      nominee: {
        nomineeName: app.nomineeName,
        nomineeDob: app.nomineeDob,
        nomineePhone: app.nomineePhone,
        nomineeAadhaar:
          this.decryptOrNull(app.nomineeAadhaarEncrypted, app.id) ??
          (app.nomineeAadhaarLast4 ? mask(app.nomineeAadhaarLast4) : null),
      },
      // Types only — never leak storage paths, original names or sizes.
      files: files.map((f) => ({ type: f.type })),
    };
  }

  /** Sends the KYC submission OTP to the user's registered email. */
  async sendSubmissionOtp(userId: string) {
    const app = await this.requireOwnedApplication(userId);
    const user = await this.repository.findUserForApplication(app.id);
    if (!user?.email) {
      throw new NotFoundException('User account not found');
    }
    const plainOtp = await this.otpService.generate(
      userId,
      OtpPurpose.KYC_SUBMIT,
    );
    await this.mailService.sendKycOtpEmail({
      to: user.email,
      firstName: user.firstName,
      otp: plainOtp,
    });
  }

  /**
   * Final submission: verifies the OTP, confirms every required document is
   * present, and moves the application to SUBMITTED. A DRAFT without files
   * is rejected here rather than half-submitted.
   */
  async submitApplication(userId: string, applicationId: string, otp: string) {
    const app = await this.assertOwnedApplication(userId, applicationId);

    if (
      app.status === KycApplicationStatus.SUBMITTED ||
      app.status === KycApplicationStatus.UNDER_REVIEW ||
      app.status === KycApplicationStatus.VERIFIED
    ) {
      throw new BadRequestException('Application is already submitted');
    }

    await this.otpService.verify(userId, OtpPurpose.KYC_SUBMIT, otp);

    const fileCount = await this.repository.countFiles(app.id);
    if (fileCount < REQUIRED_FILE_TYPES.length) {
      throw new BadRequestException(
        'Please upload all required documents before submitting.',
      );
    }

    return this.repository.markSubmitted(app.id);
  }

  /**
   * Central IDOR guard for id-scoped user routes: the application must
   * exist AND belong to the caller. Also restricts file mutation to
   * DRAFT/REJECTED states, so a submitted application is immutable.
   */
  async assertOwnedApplication(userId: string, applicationId: string) {
    const app = await this.repository.findById(applicationId);
    if (!app) {
      throw new NotFoundException('Application not found');
    }
    if (app.userId !== userId) {
      throw new ForbiddenException('Application not found');
    }
    if (
      app.status !== KycApplicationStatus.DRAFT &&
      app.status !== KycApplicationStatus.REJECTED
    ) {
      throw new BadRequestException(
        'Application is no longer editable. Contact support if this is a mistake.',
      );
    }
    return app;
  }

  // ----------------------------------------------------------------- admin

  async listApplications(query: ListApplicationsQueryDto) {
    return this.repository.list({
      status: query.status,
      search: query.search?.trim() || undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /**
   * Admin detail. The full identifier values are decrypted ONLY here, only
   * for an ADMIN (enforced by the controller's RolesGuard), because review
   * must verify the numbers against the uploaded documents. A value that
   * fails to decrypt (tampered ciphertext or changed key) falls back to the
   * mask and is logged. Applications created before the encrypted layer
   * (null ciphertext) also return masks.
   */
  async getApplicationDetail(applicationId: string) {
    const app = await this.repository.findDetail(applicationId);
    if (!app) throw new NotFoundException('Application not found');

    const decryptOrNull = (ciphertext: string | null) =>
      this.decryptOrNull(ciphertext, applicationId);

    return {
      id: app.id,
      clientId: app.user?.clientId ?? null,
      status: app.status,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
      submittedAt: app.submittedAt,
      reviewedAt: app.reviewedAt,
      reviewNote: app.reviewNote,
      personal: {
        fullName: app.fullName,
        phone: app.phone,
        dob: app.dob,
        gender: app.gender,
        maritalStatus: app.maritalStatus,
      },
      documents: {
        aadhaarNumber:
          decryptOrNull(app.aadhaarNumberEncrypted) ??
          mask(app.aadhaarNumberLast4),
        panNumber:
          decryptOrNull(app.panNumberEncrypted) ?? mask(app.panNumberLast4),
      },
      bank: {
        accountHolderName: app.accountHolderName,
        accountNumber:
          decryptOrNull(app.accountNumberEncrypted) ??
          mask(app.accountNumberLast4),
        ifscCode:
          decryptOrNull(app.ifscCodeEncrypted) ?? mask(app.ifscCodeLast4),
        bankName: app.bankName,
        branchName: app.branchName,
        accountType: app.accountType,
        branchAddress: app.branchAddress,
      },
      nominee: {
        nomineeName: app.nomineeName,
        nomineeDob: app.nomineeDob,
        nomineePhone: app.nomineePhone,
        nomineeAadhaar:
          decryptOrNull(app.nomineeAadhaarEncrypted) ??
          (app.nomineeAadhaarLast4 ? mask(app.nomineeAadhaarLast4) : null),
      },
      files: app.files.map((f) => ({
        id: f.id,
        type: f.type,
        originalName: f.originalName,
        mimeType: f.mimeType,
        fileSize: f.fileSize,
        createdAt: f.createdAt,
      })),
    };
  }

  /**
   * Decrypts a stored identifier. A value that fails to decrypt (tampered
   * ciphertext or changed key) returns null and is logged — callers fall
   * back to the last-4 mask.
   */
  private decryptOrNull(
    ciphertext: string | null,
    applicationId: string,
  ): string | null {
    if (!ciphertext) return null;
    try {
      return this.encryption.decrypt(ciphertext);
    } catch {
      this.logger.warn(
        `Failed to decrypt a KYC identifier in application ${applicationId} — ciphertext is invalid or the key changed`,
      );
      return null;
    }
  }

  /** Admin decision: UNDER_REVIEW / VERIFIED / REJECTED. */
  async updateStatus(
    applicationId: string,
    adminId: string,
    status: KycApplicationStatus,
    note?: string,
  ) {
    const app = await this.repository.findById(applicationId);
    if (!app) throw new NotFoundException('Application not found');

    // A rejection must always carry a reason (emailed to the user).
    if (status === KycApplicationStatus.REJECTED && !note?.trim()) {
      throw new BadRequestException(
        'A rejection reason is required for this decision',
      );
    }

    // The note only belongs to a rejection. Approving or reopening the
    // application clears any previous rejection note.
    const effectiveNote =
      status === KycApplicationStatus.REJECTED ? note : null;

    const updated = await this.repository.setStatus(
      applicationId,
      status,
      adminId,
      effectiveNote,
    );

    if (status === KycApplicationStatus.VERIFIED) {
      const user = await this.repository.findUserForApplication(applicationId);
      if (user?.email && user.clientId) {
        await this.mailService.sendKycApprovedEmail({
          to: user.email,
          firstName: user.firstName,
          clientId: user.clientId,
        });
      }
    }

    if (status === KycApplicationStatus.REJECTED) {
      const user = await this.repository.findUserForApplication(applicationId);
      if (user?.email && user.clientId) {
        await this.mailService.sendKycRejectedEmail({
          to: user.email,
          firstName: user.firstName,
          clientId: user.clientId,
          reason: note ?? '',
        });
      }
    }

    return { id: updated.id, status: updated.status };
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Returns the KYC status for the given user, normalized to a small
   * union the rest of the app can rely on:
   *
   *   - "VERIFIED"        — the user has a verified KYC application
   *   - "PENDING"         — the user has a non-VERIFIED application in
   *                         some state (DRAFT / SUBMITTED / UNDER_REVIEW)
   *   - "REJECTED"        — the latest application was rejected
   *   - "NOT_STARTED"     — the user has never submitted a KYC app
   *
   * Spec §9 (investment eligibility): only VERIFIED users may make
   * deposits or investments, and therefore may earn any kind of
   * commission. All three investment entry points (deposit, fund,
   * SIP, FD) call `assertKycVerified` below to enforce this.
   */
  async getKycStatus(
    userId: string,
  ): Promise<'VERIFIED' | 'PENDING' | 'REJECTED' | 'NOT_STARTED'> {
    const app = await this.repository.findByUserId(userId);
    if (!app) return 'NOT_STARTED';
    if (app.status === KycApplicationStatus.VERIFIED) return 'VERIFIED';
    if (app.status === KycApplicationStatus.REJECTED) return 'REJECTED';
    return 'PENDING';
  }

  /**
   * Throws `ForbiddenException` if the user is not KYC-verified. This
   * is the single source of truth for "can this user move money" and
   * is called by the deposit, investment-fund, SIP, and fixed-deposit
   * create-application paths.
   */
  async assertKycVerified(userId: string): Promise<void> {
    const status = await this.getKycStatus(userId);
    if (status === 'VERIFIED') return;
    const reason =
      status === 'NOT_STARTED'
        ? 'KYC verification is required before making any deposit or investment. Complete your KYC first.'
        : status === 'REJECTED'
          ? 'Your KYC application was rejected. Please contact support to resubmit before making any investment.'
          : 'Your KYC application is still under review. You will be able to invest once it is verified.';
    throw new ForbiddenException(reason);
  }

  private async requireOwnedApplication(userId: string) {
    const app = await this.repository.findByUserId(userId);
    if (!app) throw new NotFoundException('No KYC application found');
    return app;
  }
}
