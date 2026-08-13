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
      dob: new Date(dto.dob),
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
      nomineeDob: new Date(dto.nomineeDob),
      nomineePhone: dto.nomineePhone?.trim() || null,
      nomineeAadhaarEncrypted: this.encryption.encrypt(dto.nomineeAadhaar),
      nomineeAadhaarLast4: dto.nomineeAadhaar.slice(-4),
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
        // Masked: only the last 4 digits are ever visible to anyone.
        aadhaarNumber: mask(app.aadhaarNumberLast4),
        panNumber: mask(app.panNumberLast4),
      },
      bank: {
        accountHolderName: app.accountHolderName,
        accountNumber: mask(app.accountNumberLast4),
        ifscCode: mask(app.ifscCodeLast4),
        bankName: app.bankName,
        branchName: app.branchName,
        accountType: app.accountType,
        branchAddress: app.branchAddress,
      },
      nominee: {
        nomineeName: app.nomineeName,
        nomineeDob: app.nomineeDob,
        nomineePhone: app.nomineePhone,
        nomineeAadhaar: mask(app.nomineeAadhaarLast4),
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

    const decryptOrNull = (ciphertext: string | null): string | null => {
      if (!ciphertext) return null;
      try {
        return this.encryption.decrypt(ciphertext);
      } catch {
        this.logger.warn(
          `Failed to decrypt a KYC identifier in application ${applicationId} — ciphertext is invalid or the key changed`,
        );
        return null;
      }
    };

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
          decryptOrNull(app.aadhaarNumberEncrypted) ?? mask(app.aadhaarNumberLast4),
        panNumber: decryptOrNull(app.panNumberEncrypted) ?? mask(app.panNumberLast4),
      },
      bank: {
        accountHolderName: app.accountHolderName,
        accountNumber:
          decryptOrNull(app.accountNumberEncrypted) ?? mask(app.accountNumberLast4),
        ifscCode: decryptOrNull(app.ifscCodeEncrypted) ?? mask(app.ifscCodeLast4),
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
          decryptOrNull(app.nomineeAadhaarEncrypted) ?? mask(app.nomineeAadhaarLast4),
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
    if (
      status === KycApplicationStatus.REJECTED &&
      !note?.trim()
    ) {
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
      if (user?.email) {
        await this.mailService.sendKycApprovedEmail({
          to: user.email,
          firstName: user.firstName,
          clientId: user.clientId ?? app.id,
        });
      }
    }

    if (status === KycApplicationStatus.REJECTED) {
      const user = await this.repository.findUserForApplication(applicationId);
      if (user?.email) {
        await this.mailService.sendKycRejectedEmail({
          to: user.email,
          firstName: user.firstName,
          clientId: user.clientId ?? app.id,
          reason: note ?? '',
        });
      }
    }

    return { id: updated.id, status: updated.status };
  }

  // ---------------------------------------------------------------- helpers

  private async requireOwnedApplication(userId: string) {
    const app = await this.repository.findByUserId(userId);
    if (!app) throw new NotFoundException('No KYC application found');
    return app;
  }
}
