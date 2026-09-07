import { Test } from '@nestjs/testing';
import { ReferralCodeService } from './referral-code.service';
import { PrismaService } from '../../database/prisma.service';

/**
 * Spec §2: codes must be exactly 8 uppercase alphanumeric characters,
 * unique, non-sequential, cryptographically random, difficult to
 * guess. The new format does NOT include the "PNT-" prefix — the
 * code is exactly 8 characters from [A-Z0-9].
 */
describe('ReferralCodeService', () => {
  let service: ReferralCodeService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReferralCodeService,
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: jest.fn() },
          },
        },
      ],
    }).compile();
    service = moduleRef.get(ReferralCodeService);
    prisma = moduleRef.get(PrismaService);
  });

  it('generates an 8-character uppercase alphanumeric code', () => {
    const code = service.generateOne();
    // 8 chars from [A-Z0-9] only.
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
    expect(code).toHaveLength(8);
  });

  it('two consecutive codes are not equal (randomness)', () => {
    const a = service.generateOne();
    const b = service.generateOne();
    expect(a).not.toBe(b);
  });

  it('does not include the "PNT-" prefix (new format)', () => {
    // The new format is exactly 8 chars with no prefix.
    for (let i = 0; i < 50; i++) {
      const code = service.generateOne();
      expect(code.startsWith('PNT-')).toBe(false);
      expect(code.length).toBe(8);
    }
  });

  it('uses both letters and digits in distribution', () => {
    // Across many codes, both letters and digits should appear.
    // Probability of getting only letters across 1000 codes is
    // (26/36)^(1000*8) ≈ 0 — effectively zero.
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = service.generateOne();
      for (const c of code) seen.add(c);
    }
    const letters = [...seen].filter((c) => /[A-Z]/.test(c)).length;
    const digits = [...seen].filter((c) => /[0-9]/.test(c)).length;
    expect(letters).toBeGreaterThan(0);
    expect(digits).toBeGreaterThan(0);
  });

  it('retries on a unique-constraint collision and eventually throws', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'x' });
    await expect(service.generateUnique()).rejects.toThrow(
      /unique referral code/,
    );
    expect(
      (prisma.user.findUnique as jest.Mock).mock.calls.length,
    ).toBeGreaterThanOrEqual(8);
  });

  it('returns the first non-colliding code', async () => {
    let calls = 0;
    (prisma.user.findUnique as jest.Mock).mockImplementation(async () => {
      calls += 1;
      if (calls < 3) return { id: 'taken' };
      return null;
    });
    const code = await service.generateUnique();
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
  });
});
