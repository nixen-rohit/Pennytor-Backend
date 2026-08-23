import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SkipCsrf } from '../csrf/csrf.guard';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';
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