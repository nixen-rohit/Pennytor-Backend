import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../guards/roles.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ReferralService } from './referral.service';
import { ReferralRepository } from './referral.repository';
import { CommissionService } from './commission.service';
import { CommissionSchedulerService } from './commission-scheduler.service';
import { SuperUserService } from './super-user.service';
import {
  CommissionAdminQueryDto,
  CreateSuperUserDto,
  ReverseCommissionDto,
  RunCommissionDto,
  ToggleEligibilityDto,
} from './dto/referral.dto';
import { PrismaService } from '../../database/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { CommissionStatus, Role } from '@prisma/client';

/**
 * Spec §26: admin-only referral endpoints. All require ADMIN role.
 *
 * Endpoints exposed:
 *   - GET    /admin/referrals/users/:id          — full user record + counts
 *   - GET    /admin/referrals/tree/:id           — full tree (L1..L∞)
 *   - PATCH  /admin/referrals/users/:id/eligibility — soft-toggle a user
 *   - GET    /admin/commissions                  — paginated ledger
 *   - POST   /admin/commissions/:id/freeze       — freeze
 *   - POST   /admin/commissions/:id/reverse      — reverse
 *   - POST   /admin/commissions/run              — manually run the cycle
 *   - POST   /admin/super-users                  — mint a SUPER_USER (spec §5)
 */
@Controller('admin')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ReferralAdminController {
  constructor(
    private readonly referral: ReferralService,
    private readonly repo: ReferralRepository,
    private readonly commissions: CommissionService,
    private readonly scheduler: CommissionSchedulerService,
    private readonly superUser: SuperUserService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('referrals/users/:id')
  async getUser(@Param('id') id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        userType: true,
        status: true,
        referralCode: true,
        referralCodeStatus: true,
        referredById: true,
        createdAt: true,
        _count: {
          select: { referrals: true, referrerRelationships: true },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  @Get('referrals/tree/:id')
  async getTree(@Param('id') id: string) {
    // Spec §25: admin sees L1..L∞ (we cap at 50 defensively).
    return this.repo.getTreeBounded(id, 50);
  }

  @Patch('referrals/users/:id/eligibility')
  async toggleEligibility(
    @Param('id') id: string,
    @Body() dto: ToggleEligibilityDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === Role.ADMIN) {
      // Spec §1: ADMIN can never be a referrer.
      throw new NotFoundException('Admin users are not eligible');
    }
    return this.prisma.user.update({
      where: { id },
      data: { referralEligible: dto.eligible },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        referralEligible: true,
      },
    });
  }

  @Get('commissions')
  async listCommissions(@Query() q: CommissionAdminQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where: any = {};
    if (q.status) where.status = q.status as CommissionStatus;
    if (q.referrerId) where.referrerId = q.referrerId;
    const [items, total] = await Promise.all([
      this.prisma.referralCommission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.referralCommission.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  @Post('commissions/:id/freeze')
  async freeze(@Param('id') id: string, @Body() body: { actorId: string }) {
    return this.commissions.freeze(id, body.actorId);
  }

  @Post('commissions/:id/reverse')
  async reverse(@Param('id') id: string, @Body() body: ReverseCommissionDto) {
    return this.commissions.reverse(id, body.actorId, body.reason);
  }

  @Post('commissions/run')
  async runCycle(@Body() body: RunCommissionDto) {
    return this.scheduler.runCycle({
      month: body.month,
      year: body.year,
      actorId: body.actorId,
    });
  }

  /**
   * Spec §5: SUPER_USER is created outside the public registration
   * flow. The new account is set as `userType = "super_user"`, has
   * `referredById = null`, and has no referral code. The same
   * investment-verification pipeline then issues a code on first
   * verified investment, after which the account follows the
   * normal L1–L5 rules.
   */
  @Post('super-users')
  async createSuperUser(@Body() dto: CreateSuperUserDto) {
    return this.superUser.createSuperUser(dto);
  }
}
