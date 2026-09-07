import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/guards/session-auth.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../../guards/roles.guard';
import { FixedDepositService } from './fixed-deposit.service';
import {
  ListFDQueryDto,
  RejectFDApplicationDto,
} from './dto/fixed-deposit.dto';

@ApiTags('fixed-deposit-admin')
@Controller('fixed-deposit-admin')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiCookieAuth()
export class FixedDepositAdminController {
  constructor(private readonly fdService: FixedDepositService) {}

  @Get('list')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Admin list FD applications' })
  listApplications(@Query() query: ListFDQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    return this.fdService.listApplications({
      page,
      pageSize,
      status: query.status,
      search: query.search,
    });
  }

  @Get('detail/:id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Admin detail FD application' })
  @ApiParam({ name: 'id', description: 'Application ID' })
  detail(@Param('id') id: string) {
    return this.fdService.getApplicationDetail(id);
  }

  @Patch('approve/:id')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Admin approve FD application' })
  @ApiParam({ name: 'id', description: 'Application ID' })
  approve(@Param('id') id: string, @CurrentUser() admin: AuthUser) {
    return this.fdService.approveApplication(id, admin.id);
  }

  @Patch('reject/:id')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Admin reject FD application' })
  @ApiParam({ name: 'id', description: 'Application ID' })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectFDApplicationDto,
    @CurrentUser() admin: AuthUser,
  ) {
    return this.fdService.rejectApplication(id, admin.id, dto.note ?? '');
  }
}
