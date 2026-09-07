import { Test } from '@nestjs/testing';
import { ReferralService } from './referral.service';
import { PrismaService } from '../../database/prisma.service';
import { ReferralRepository } from './referral.repository';
import { ReferralCodeService } from './referral-code.service';
import { InvestmentEligibilityService } from './investment-eligibility.service';
import { CommissionConfigService } from './commission-config.service';
import { AuditService } from '../audit/audit.service';
import { KycService } from '../kyc/kyc.service';
import { Role, ReferralCodeStatus, UserStatus } from '@prisma/client';

/**
 * Unit tests for ReferralService — covers spec §4 (registration
 * validation: code must be ACTIVE, referrer must not be ADMIN,
 * referrer must have a qualifying investment), spec §5 (SUPER_USER
 * is created without a code or referrer), and spec §10/§11
 * (onInvestmentVerified generates a code once and only once;
 * onInvestmentDeactivated sets INACTIVE when no other investment
 * qualifies).
 */
describe('ReferralService', () => {
  let service: ReferralService;
  let prisma: any;
  let eligibility: any;
  let codeService: any;
  let audit: any;
  let kycService: any;

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      referralRelationship: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      userConsent: { create: jest.fn() },
    };
    eligibility = {
      hasQualifyingActiveInvestment: jest.fn().mockResolvedValue(true),
      countVerifiedDirectReferrals: jest.fn().mockResolvedValue(0),
    };
    codeService = {
      generateUnique: jest.fn().mockResolvedValue('X8K4M92Q'),
    };
    audit = { log: jest.fn() };
    kycService = {
      getKycStatus: jest.fn().mockResolvedValue('VERIFIED'),
      assertKycVerified: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReferralService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ReferralRepository,
          useValue: { findActiveReferrerByCode: jest.fn() },
        },
        { provide: ReferralCodeService, useValue: codeService },
        { provide: InvestmentEligibilityService, useValue: eligibility },
        { provide: CommissionConfigService, useValue: { get: jest.fn() } },
        { provide: AuditService, useValue: audit },
        { provide: KycService, useValue: kycService },
      ],
    }).compile();

    service = moduleRef.get(ReferralService);
  });

  // ─── registerWithReferral ─────────────────────────────────────────────

  it('rejects registration when the referrer is missing (spec §4)', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.registerWithReferral({
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        passwordHash: 'h',
        marketingEmails: false,
        referralCode: 'BADCODE',
      }),
    ).rejects.toThrow(/Invalid or unavailable referral code/);
  });

  it('rejects when the referrer is an ADMIN (spec §1)', async () => {
    // The repository filter `role: { not: Role.ADMIN }` guarantees an
    // ADMIN row never satisfies the lookup — `findFirst` returns null
    // and we surface the generic "Invalid or unavailable referral
    // code." message.
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.registerWithReferral({
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        passwordHash: 'h',
        marketingEmails: false,
        referralCode: 'ADMIN-CODE',
      }),
    ).rejects.toThrow(/Invalid or unavailable referral code/);
  });

  it('rejects when the referrer lacks a qualifying investment (spec §4 #7)', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'r1',
      role: Role.USER,
      status: UserStatus.ACTIVE,
    });
    eligibility.hasQualifyingActiveInvestment.mockResolvedValueOnce(false);
    await expect(
      service.registerWithReferral({
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        passwordHash: 'h',
        marketingEmails: false,
        referralCode: 'GOOD-CODE',
      }),
    ).rejects.toThrow(/Invalid or unavailable referral code/);
  });

  it('creates the user + relationship in a transaction (spec §4)', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'r1',
      role: Role.USER,
      status: UserStatus.ACTIVE,
    });
    prisma.user.findUnique.mockResolvedValue(null); // email not taken
    prisma.user.create.mockResolvedValue({
      id: 'new-user',
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.com',
    });
    prisma.referralRelationship.create.mockResolvedValue({});
    prisma.userConsent.create.mockResolvedValue({});

    const out = await service.registerWithReferral({
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.com',
      passwordHash: 'h',
      marketingEmails: true,
      referralCode: 'GOOD-CODE',
    });
    expect(out.user.id).toBe('new-user');
    expect(prisma.referralRelationship.create).toHaveBeenCalledWith({
      data: { referrerId: 'r1', referredUserId: 'new-user' },
    });
    expect(prisma.userConsent.create).toHaveBeenCalled();
  });

  // ─── createSuperUser (spec §5) ─────────────────────────────────────────

  it('creates a SUPER_USER with no referrer and no code (spec §5)', async () => {
    prisma.user.findUnique.mockResolvedValue(null); // email not taken
    prisma.user.create.mockResolvedValue({
      id: 'su-1',
      firstName: 'S',
      lastName: 'U',
      email: 'su@example.com',
    });
    prisma.userConsent.create.mockResolvedValue({});

    const out = await service.createSuperUser({
      firstName: 'S',
      lastName: 'U',
      email: 'su@example.com',
      passwordHash: 'h',
      marketingEmails: false,
    });
    expect(out.user.id).toBe('su-1');
    const arg = prisma.user.create.mock.calls[0][0];
    expect(arg.data.referredById).toBeNull();
    expect(arg.data.referralCode).toBeNull();
    expect(arg.data.userType).toBe('super_user');
    expect(arg.data.role).toBe(Role.USER);
  });

  // ─── onInvestmentVerified (spec §10) ──────────────────────────────────

  it('generates a referral code on the first verified investment', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      role: Role.USER,
      referralCode: null,
      referredById: 'r1',
    });
    eligibility.hasQualifyingActiveInvestment.mockResolvedValue(true);
    prisma.user.update
      .mockResolvedValueOnce({ id: 'u1' }) // generate code
      .mockResolvedValueOnce({ id: 'u1' }); // set status

    await service.onInvestmentVerified('u1');
    expect(codeService.generateUnique).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalled();
  });

  it('does NOT regenerate a code on subsequent verifications (spec §10)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      role: Role.USER,
      referralCode: 'X8K4M92Q',
      referredById: 'r1',
      referralCodeStatus: ReferralCodeStatus.ACTIVE,
    });
    eligibility.hasQualifyingActiveInvestment.mockResolvedValue(true);

    await service.onInvestmentVerified('u1');
    expect(codeService.generateUnique).not.toHaveBeenCalled();
  });

  // ─── onInvestmentDeactivated (spec §11) ──────────────────────────────

  it('sets the code INACTIVE when the user has no other qualifying investment', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 'u1',
        role: Role.USER,
        referralCode: 'X8K4M92Q',
      })
      .mockResolvedValueOnce({ referralCodeStatus: ReferralCodeStatus.ACTIVE });
    eligibility.hasQualifyingActiveInvestment.mockResolvedValue(false);

    await service.onInvestmentDeactivated('u1');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: { referralCodeStatus: ReferralCodeStatus.INACTIVE },
      }),
    );
  });
});
