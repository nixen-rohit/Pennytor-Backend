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
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/guards/session-auth.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../../guards/roles.guard';
import { SIPForChildService } from './sip-for-child.service';
import {
  ListSIPForChildQueryDto,
  UpdateSIPForChildStatusDto,
} from './dto/sip-for-child.dto';

@Controller('sip-for-child-admin')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class SIPForChildAdminController {
  constructor(private readonly sipForChildService: SIPForChildService) {}

  @Get('list')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
    listApplications(@Query() query: ListSIPForChildQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    return this.sipForChildService.adminList({
      page,
      pageSize,
      status: query.status as any,
      search: query.search,
    });
  }

  @Get('detail/:id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
      detail(@Param('id') id: string) {
    return this.sipForChildService.adminDetail(id);
  }

  @Patch('approve/:id')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
      approve(@Param('id') id: string, @CurrentUser() admin: AuthUser) {
    return this.sipForChildService.approve(id, admin.id);
  }

  @Patch('reject/:id')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
      reject(
    @Param('id') id: string,
    @Body() updateDto: UpdateSIPForChildStatusDto,
    @CurrentUser() admin: AuthUser,
  ) {
    return this.sipForChildService.reject(id, admin.id, updateDto.note);
  }
}
