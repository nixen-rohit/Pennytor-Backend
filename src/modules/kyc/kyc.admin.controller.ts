import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { KycFileAuditAction, Role } from '@prisma/client';
import { KycService } from './kyc.service';
import { KycFileService } from './kyc.file.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../../guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/guards/session-auth.guard';
import { ListApplicationsQueryDto } from './dto/list-applications-query.dto';
import { UpdateKycStatusDto } from './dto/update-kyc-status.dto';
import { ReplaceKycFileDto } from './dto/replace-kyc-file.dto';
import { kycMulterOptions } from '../../middleware/upload';
import { KYC_FILE_MAX_BYTES } from './kyc.types';
import { contentDisposition } from '../../common/utils/storage.util';
import { BadRequestException } from '@nestjs/common';

/**
 * Admin-only KYC review surface. Every route here is gated by
 * SessionAuthGuard + RolesGuard(@Roles(ADMIN)); the frontend's role check
 * is presentation-only. All private files are streamed through these
 * endpoints — there is no public URL for any KYC document.
 */
@Controller('admin/kyc')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class KycAdminController {
  constructor(
    private readonly kycService: KycService,
    private readonly fileService: KycFileService,
  ) {}

  @Get('applications')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  listApplications(@Query() query: ListApplicationsQueryDto) {
    return this.kycService.listApplications(query);
  }

  /** Full detail. Sensitive fields are decrypted only here, for ADMINs. */
  @Get('applications/:applicationId')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  getApplication(@Param('applicationId') applicationId: string) {
    return this.kycService.getApplicationDetail(applicationId);
  }

  /**
   * Inline document view. Streams with the correct Content-Type, no-store
   * caching, and records a VIEW audit entry.
   */
  @Get('applications/:applicationId/files/:fileId')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async viewFile(
    @CurrentUser() admin: AuthUser,
    @Param('applicationId') applicationId: string,
    @Param('fileId') fileId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, stream } = await this.fileService.streamFile(
      applicationId,
      fileId,
    );

    res.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.fileSize),
      'Content-Disposition': contentDisposition(file.originalName, false),
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    });

    await this.fileService.auditAction({
      fileId: file.id,
      fileType: file.type,
      storagePath: file.storagePath,
      adminId: admin.id,
      action: KycFileAuditAction.VIEW,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    return new StreamableFile(stream);
  }

  /** Forced-download variant with its own DOWNLOAD audit entry. */
  @Get('applications/:applicationId/files/:fileId/download')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async downloadFile(
    @CurrentUser() admin: AuthUser,
    @Param('applicationId') applicationId: string,
    @Param('fileId') fileId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, stream } = await this.fileService.streamFile(
      applicationId,
      fileId,
    );

    res.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.fileSize),
      'Content-Disposition': contentDisposition(file.originalName, true),
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    });

    await this.fileService.auditAction({
      fileId: file.id,
      fileType: file.type,
      storagePath: file.storagePath,
      adminId: admin.id,
      action: KycFileAuditAction.DOWNLOAD,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    return new StreamableFile(stream);
  }

  /** Removes the physical file + metadata, with a DELETE audit entry. */
  @Delete('applications/:applicationId/files/:fileId')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async deleteFile(
    @CurrentUser() admin: AuthUser,
    @Param('applicationId') applicationId: string,
    @Param('fileId') fileId: string,
    @Req() req: Request,
  ) {
    await this.fileService.deleteFile({
      applicationId,
      fileId,
      adminId: admin.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    return { message: 'File deleted' };
  }

  /**
   * Admin document replacement (support flow). The old physical file is
   * deleted only after the new one is stored and audited; the metadata row
   * keeps its id and type, so the application detail view is unchanged.
   */
  @Put('applications/:applicationId/files/:fileId')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', kycMulterOptions(KYC_FILE_MAX_BYTES)),
  )
  async replaceFile(
    @CurrentUser() admin: AuthUser,
    @Param('applicationId') applicationId: string,
    @Param('fileId') fileId: string,
    @Body() dto: ReplaceKycFileDto,
    @Req() req: Request,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const stored = await this.fileService.replaceFile({
      applicationId,
      fileId,
      buffer: file.buffer,
      originalName: file.originalname,
      adminId: admin.id,
      reason: dto.reason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    return {
      id: stored.id,
      type: stored.type,
      mimeType: stored.mimeType,
      fileSize: stored.fileSize,
      originalName: stored.originalName,
      message: 'Document replaced',
    };
  }

  /** Review decision: UNDER_REVIEW / VERIFIED / REJECTED (+ optional note). */
  @Patch('applications/:applicationId/status')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  updateStatus(
    @CurrentUser() admin: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body() dto: UpdateKycStatusDto,
  ) {
    return this.kycService.updateStatus(
      applicationId,
      admin.id,
      dto.status,
      dto.note,
    );
  }
}
