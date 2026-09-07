import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { KycService } from './kyc.service';
import { KycFileService } from './kyc.file.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/guards/session-auth.guard';
import { CreateKycApplicationDto } from './dto/create-kyc-application.dto';
import { SubmitKycApplicationDto } from './dto/submit-kyc-application.dto';
import { UploadFileDto } from './dto/upload-file.dto';
import { kycMulterOptions } from '../../middleware/upload';
import { KYC_FILE_MAX_BYTES } from './kyc.types';

/**
 * User-facing KYC endpoints. Everything here is session-authenticated and
 * scoped to the caller's own application (assertOwnedApplication enforces
 * the ownership check server-side; a foreign id is indistinguishable from
 * "not found").
 */
@ApiTags('kyc')
@Controller('kyc')
@UseGuards(SessionAuthGuard)
@ApiCookieAuth()
export class KycController {
  constructor(
    private readonly kycService: KycService,
    private readonly fileService: KycFileService,
  ) {}

  /** Upserts the caller's application as a DRAFT. */
  @Post('applications')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({
    summary: 'Create or update the caller KYC application (DRAFT)',
  })
  createApplication(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateKycApplicationDto,
  ) {
    return this.kycService.createApplication(user.id, dto);
  }

  /** Caller's own application summary (id, status, file metadata). */
  @Get('applications/me')
  @ApiOperation({ summary: 'Get the caller KYC application status and files' })
  getMyApplication(@CurrentUser() user: AuthUser) {
    return this.kycService.getMyApplication(user.id);
  }

  /**
   * Multipart upload: field `file` + text field `fileType`.
   * One file per request; re-uploading a type replaces the previous file
   * (enforced by the @@unique([applicationId, type]) constraint).
   */
  @Post('applications/:applicationId/files')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @UseInterceptors(
    FileInterceptor('file', kycMulterOptions(KYC_FILE_MAX_BYTES)),
  )
  @ApiOperation({
    summary: 'Upload one KYC document for the caller application',
  })
  async uploadFile(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body() dto: UploadFileDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    // Ownership + editable-state guard runs before any disk write.
    await this.kycService.assertOwnedApplication(user.id, applicationId);

    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const stored = await this.fileService.storeFile({
      applicationId,
      type: dto.fileType,
      buffer: file.buffer,
      originalName: file.originalname,
    });

    // Never expose filesystem details; only what the client needs.
    return {
      id: stored.id,
      type: stored.type,
      mimeType: stored.mimeType,
      fileSize: stored.fileSize,
    };
  }

  /** Sends the submission OTP to the caller's registered email. */
  @Post('applications/:applicationId/otp')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Send the KYC submission OTP email' })
  async sendOtp(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    await this.kycService.assertOwnedApplication(user.id, applicationId);
    await this.kycService.sendSubmissionOtp(user.id);
    return { message: 'Verification code sent to your email' };
  }

  /** Verifies the OTP and submits the application. */
  @Post('applications/:applicationId/submit')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify OTP and submit the KYC application' })
  async submitApplication(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body() dto: SubmitKycApplicationDto,
  ) {
    const app = await this.kycService.submitApplication(
      user.id,
      applicationId,
      dto.otp,
    );
    return { id: app.id, status: app.status };
  }
}
