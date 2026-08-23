import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { SkipCsrf } from '../csrf/csrf.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../../guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';
import { ListContactMessagesQueryDto } from './dto/list-contact-messages-query.dto';
import { ContactUsService } from './contactus.service';

@Controller('contactus')
export class ContactUsController {
  constructor(private readonly contactUsService: ContactUsService) {}

  @Post()
  @SkipCsrf()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  create(@Body() dto: CreateContactMessageDto) {
    return this.contactUsService.create(dto);
  }
}

@Controller('admin/contactus')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ContactUsAdminController {
  constructor(private readonly contactUsService: ContactUsService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  list(@Query() query: ListContactMessagesQueryDto) {
    return this.contactUsService.list(query.page, query.limit);
  }
}