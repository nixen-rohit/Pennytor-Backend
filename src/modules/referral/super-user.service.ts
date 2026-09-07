import { Injectable, Logger } from '@nestjs/common';
import { ReferralService } from './referral.service';
import { hashPassword } from '../../common/utils/password.util';
import { CreateSuperUserDto } from './dto/referral.dto';
import { CommissionConfigService } from './commission-config.service';

/**
 * Spec §5: SUPER_USER creation is an admin-only path that runs OUTSIDE
 * the public registration flow. This service is exposed through the
 * `POST /admin/super-users` route (admin role required) and is ALSO
 * used by the standalone `user-generation/seed-super-user.js` script
 * for environments where the API is not yet running.
 *
 * The SUPER_USER must then go through the same investment-verification
 * pipeline as any other user to receive a referral code (spec §5).
 */
@Injectable()
export class SuperUserService {
  private readonly logger = new Logger(SuperUserService.name);

  constructor(
    private readonly referral: ReferralService,
    private readonly config: CommissionConfigService,
  ) {}

  async createSuperUser(dto: CreateSuperUserDto) {
    // Make sure the config table is seeded (it must exist before any
    // commission run) — this is a safe no-op after the first call.
    await this.config.get();
    const passwordHash = await hashPassword(dto.password);
    return this.referral.createSuperUser({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      passwordHash,
      marketingEmails: dto.marketingEmails ?? false,
    });
  }
}
