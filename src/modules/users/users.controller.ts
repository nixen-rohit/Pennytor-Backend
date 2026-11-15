import {
  Controller,
  Param,
  Patch,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../../guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('users')
// Authorization is enforced server-side, on every request. The Next.js
// frontend only decides what to render; it is never the security boundary.
@UseGuards(SessionAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  async approveUser(@Param('id') id: string) {
    return this.usersService.approveUser(id);
  }
}
