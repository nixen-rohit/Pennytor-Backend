import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService, RequestContext } from './auth.service';
import { UsersService } from '../users/users.service';
import { OtpService } from '../otp/otp.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../session/session.service';
import { ReferralService } from '../referral/referral.service';
import { PrismaService } from '../../database/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let otpService: jest.Mocked<OtpService>;
  let mailService: jest.Mocked<MailService>;
  let auditService: jest.Mocked<AuditService>;
  let sessionService: jest.Mocked<SessionService>;
  let referralService: jest.Mocked<ReferralService>;

  const mockCtx: RequestContext = {
    ipAddress: '127.0.0.1',
    userAgent: 'Jest Test Agent',
  };

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abcdefghijklmnopqrstuv$abcdefghijklmnopqrstuvwxyz123456',
    emailVerified: true,
    status: 'ACTIVE',
    role: 'USER',
    lockedUntil: null,
    failedLoginAttempts: 0,
    clientId: 'CLIENT-001',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            findById: jest.fn(),
            markEmailVerified: jest.fn().mockResolvedValue(mockUser as any),
            recordFailedLogin: jest.fn(),
            recordSuccessfulLogin: jest.fn(),
            updatePasswordHash: jest.fn(),
          },
        },
        {
          provide: OtpService,
          useValue: {
            generate: jest.fn(),
            verify: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendVerificationEmail: jest.fn(),
            sendPasswordResetEmail: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn(),
          },
        },
        {
          provide: SessionService,
          useValue: {
            create: jest.fn(),
            revoke: jest.fn().mockResolvedValue(undefined),
            revokeAllForUser: jest.fn().mockResolvedValue(1),
          },
        },
        {
          provide: ReferralService,
          useValue: {
            registerWithReferral: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: { $transaction: jest.fn((cb) => cb({})) },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(15) },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    otpService = module.get(OtpService);
    mailService = module.get(MailService);
    auditService = module.get(AuditService);
    sessionService = module.get(SessionService);
    referralService = module.get(ReferralService);
  });

  describe('checkEmail', () => {
    it('returns available: true when email is not taken', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      const result = await service.checkEmail('new@example.com');

      expect(result).toEqual({ available: true });
      expect(usersService.findByEmail).toHaveBeenCalledWith('new@example.com');
    });

    it('returns available: false when email is already registered', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as any);

      const result = await service.checkEmail('test@example.com');

      expect(result).toEqual({ available: false });
    });
  });

  describe('register', () => {
    const registerDto = {
      firstName: 'New',
      lastName: 'User',
      email: 'new@example.com',
      password: 'Test@123456',
      referralCode: 'VALID123',
      acceptTerms: true,
    };

    it('registers user with valid referral code', async () => {
      referralService.registerWithReferral.mockResolvedValue({
        user: { id: 'new-user-id', clientId: 'CLIENT-NEW' },
      } as any);
      otpService.generate.mockResolvedValue('123456');

      const result = await service.register(registerDto, mockCtx);

      expect(result.message).toBe('Registration successful. Please verify your email.');
      expect(result.userId).toBe('new-user-id');
      expect(referralService.registerWithReferral).toHaveBeenCalled();
      expect(otpService.generate).toHaveBeenCalledWith('new-user-id', 'EMAIL_VERIFY');
      expect(mailService.sendVerificationEmail).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REGISTER' }),
      );
    });

    it('throws BadRequestException when no referral code provided', async () => {
      await expect(
        service.register({ ...registerDto, referralCode: '' }, mockCtx),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when referral code is invalid', async () => {
      referralService.registerWithReferral.mockRejectedValue(
        new BadRequestException('Invalid referral code'),
      );

      await expect(
        service.register({ ...registerDto, referralCode: 'INVALID' }, mockCtx),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyEmail', () => {
    const verifyDto = { email: 'test@example.com', otp: '123456' };

    it('verifies email successfully with correct OTP', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as any);
      otpService.verify.mockResolvedValue(undefined);
      usersService.markEmailVerified.mockResolvedValue(mockUser as any);

      const result = await service.verifyEmail(verifyDto, mockCtx);

      expect(result.message).toBe('Email verified successfully.');
      expect(otpService.verify).toHaveBeenCalledWith('user-123', 'EMAIL_VERIFY', '123456');
      expect(usersService.markEmailVerified).toHaveBeenCalledWith('user-123');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EMAIL_VERIFIED' }),
      );
    });

    it('throws BadRequestException when user not found', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(service.verifyEmail(verifyDto, mockCtx)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when OTP is invalid', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as any);
      otpService.verify.mockRejectedValue(
        new BadRequestException('Incorrect verification code'),
      );

      await expect(service.verifyEmail(verifyDto, mockCtx)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('logout', () => {
    it('revokes session and logs audit', async () => {
      await service.logout('session-token', 'user-123', mockCtx);

      expect(sessionService.revoke).toHaveBeenCalledWith('session-token');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LOGOUT' }),
      );
    });
  });

  describe('logoutAll', () => {
    it('revokes all sessions and logs audit', async () => {
      const result = await service.logoutAll('user-123', mockCtx);

      expect(result.message).toBe('Logged out everywhere. All sessions were revoked.');
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith('user-123');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LOGOUT_ALL' }),
      );
    });
  });
});
