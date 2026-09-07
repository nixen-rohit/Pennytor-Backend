import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';
import { UpdateContactStatusDto } from './dto/update-contact-status.dto';

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

  async list(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.contactMessage.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.contactMessage.count(),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async get(id: string) {
    const message = await this.prisma.contactMessage.findUnique({
      where: { id },
    });
    if (!message) {
      throw new NotFoundException('Contact message not found');
    }
    return message;
  }

  async updateStatus(id: string, dto: UpdateContactStatusDto) {
    const existing = await this.prisma.contactMessage.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Contact message not found');
    }

    return this.prisma.contactMessage.update({
      where: { id },
      data: {
        status: dto.status,
        reviewNote: dto.note || null,
      },
    });
  }

  async delete(id: string) {
    const existing = await this.prisma.contactMessage.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Contact message not found');
    }

    await this.prisma.contactMessage.delete({ where: { id } });
    return { success: true };
  }
}
