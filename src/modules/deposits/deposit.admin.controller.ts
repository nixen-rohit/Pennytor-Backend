import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Request, Response } from 'express';
import { DepositService } from './deposit.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../../guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/guards/session-auth.guard';
import { ListDepositsQueryDto } from './dto/list-deposits-query.dto';
import { RejectDepositDto } from './dto/reject-deposit.dto';
import { contentDisposition } from '../../common/utils/storage.util';

/**
 * Admin-only deposit review surface. Every route is gated by
 * SessionAuthGuard + RolesGuard(@Roles(ADMIN)); the frontend's role check
 * is presentation-only. Screenshots are streamed through these endpoints —
 * there is no public URL for any deposit screenshot.
 */
@ApiTags('admin-deposits')
@Controller('admin/deposits')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiCookieAuth()
export class DepositAdminController {
  constructor(private readonly depositService: DepositService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'List deposit requests (filter by status/search)' })
  listDeposits(@Query() query: ListDepositsQueryDto) {
    return this.depositService.listDeposits(query);
  }

  @Get(':id')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Deposit request detail' })
  getDeposit(@Param('id') id: string) {
    return this.depositService.getDepositDetail(id);
  }

  /** Inline screenshot view. */
  @Get(':id/file')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async viewFile(@Param('id') id: string, @Res() res: Response) {
    const { row, stream } = await this.depositService.streamFile(id);
    res.setHeader('Content-Type', row.mimeType);
    res.setHeader('Content-Length', String(row.fileSize));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      contentDisposition(row.originalName, false),
    );
    stream.pipe(res);
  }

  /** Download the screenshot. */
  @Get(':id/file/download')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async downloadFile(@Param('id') id: string, @Res() res: Response) {
    const { row, stream } = await this.depositService.streamFile(id);
    res.setHeader('Content-Type', row.mimeType);
    res.setHeader('Content-Length', String(row.fileSize));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      contentDisposition(row.originalName, true),
    );
    stream.pipe(res);
  }

  /** Approve — atomic credit + ledger + audit; only pending can be approved (409 otherwise). */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Approve a deposit (credits wallet + ledger, audited)',
  })
  approve(@Param('id') id: string, @CurrentUser() admin: AuthUser) {
    return this.depositService.approve(id, admin.id);
  }

  /** Reject with a reason — no money moves; only pending can be rejected (409 otherwise). */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reject a deposit with a reason (audited)' })
  reject(
    @Param('id') id: string,
    @CurrentUser() admin: AuthUser,
    @Body() dto: RejectDepositDto,
  ) {
    return this.depositService.reject(id, admin.id, dto.note);
  }

  /** Delete deposit screenshot only — keeps the record for audit trail. */
  @Delete(':id/file')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Delete deposit screenshot (admin, audited)' })
  async deleteFile(
    @Param('id') id: string,
    @CurrentUser() admin: AuthUser,
    @Req() req: Request,
  ) {
    await this.depositService.deleteFile(
      id,
      admin.id,
      req.ip,
      req.headers['user-agent'] as string | undefined,
    );
    return { message: 'Screenshot deleted' };
  }

  /** Delete entire deposit record (history). */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Delete deposit record (admin, audited)' })
  async deleteDeposit(
    @Param('id') id: string,
    @CurrentUser() admin: AuthUser,
    @Req() req: Request,
  ) {
    await this.depositService.deleteDeposit(
      id,
      admin.id,
      req.ip,
      req.headers['user-agent'] as string | undefined,
    );
    return { message: 'Deposit record deleted' };
  }
}
