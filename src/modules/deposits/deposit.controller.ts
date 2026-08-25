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
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DepositService } from './deposit.service';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { kycMulterOptions } from '../../middleware/upload';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/guards/session-auth.guard';

const DEPOSIT_FILE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * User-side fund deposit requests. CSRF is enforced globally; ownership is
 * derived from the session — a user can never create a request for someone
 * else.
 */
@ApiTags('deposits')
@Controller('deposits')
@UseGuards(SessionAuthGuard)
@ApiCookieAuth()
export class DepositController {
  constructor(private readonly depositService: DepositService) {}

  @Get('mine')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'List the caller deposit requests' })
  myDeposits(@CurrentUser() user: AuthUser) {
    return this.depositService.myDeposits(user.id);
  }

  @Get(':id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get a single deposit request by ID' })
  async getDeposit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.depositService.getDeposit(user.id, id);
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', kycMulterOptions(DEPOSIT_FILE_MAX_BYTES)),
  )
  @ApiOperation({
    summary: 'Submit a deposit request with payment screenshot',
  })
  async createDeposit(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDepositDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No screenshot uploaded');
    }

    return this.depositService.createDeposit(
      user.id,
      dto,
      file.buffer,
      file.originalname,
    );
  }
}