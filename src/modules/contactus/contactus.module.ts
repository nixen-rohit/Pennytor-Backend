import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import {
  ContactUsAdminController,
  ContactUsController,
} from './contactus.controller';
import { ContactUsService } from './contactus.service';

@Module({
  imports: [PrismaModule],
  controllers: [ContactUsController, ContactUsAdminController],
  providers: [ContactUsService],
})
export class ContactUsModule {}