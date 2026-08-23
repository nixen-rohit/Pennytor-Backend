import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

@Injectable()
export class ContactUsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateContactMessageDto) {
    const contactMessage = await this.prisma.contactMessage.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        service: dto.service || null,
        message: dto.message,
      },
    });

    return {
      id: contactMessage.id,
      status: contactMessage.status,
      createdAt: contactMessage.createdAt,
    };
  }
}