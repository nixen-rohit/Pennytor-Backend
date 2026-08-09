import {
  Controller,
  Param,
  Patch,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../../guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('users')
@Controller('users')
// Authorization is enforced server-side, on every request. The Next.js
// frontend only decides what to render; it is never the security boundary.
@UseGuards(SessionAuthGuard, RolesGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Approve a user account and generate Client ID' })
  @ApiResponse({ status: 200, description: 'User approved and email sent' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async approveUser(@Param('id') id: string) {
    return this.usersService.approveUser(id);
  }
}
