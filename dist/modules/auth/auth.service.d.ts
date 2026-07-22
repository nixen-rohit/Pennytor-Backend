import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { OtpService } from '../otp/otp.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { RefreshTokenService } from './refresh-token.service';
import { PrismaService } from '../../database/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
export interface RequestContext {
    ipAddress?: string;
    userAgent?: string;
}
export declare class AuthService {
    private readonly usersService;
    private readonly otpService;
    private readonly mailService;
    private readonly auditService;
    private readonly prisma;
    private readonly config;
    private readonly jwtService;
    private readonly refreshTokenService;
    private readonly logger;
    private readonly saltRounds;
    private readonly accessExpiry;
    private readonly resetExpiryMinutes;
    constructor(usersService: UsersService, otpService: OtpService, mailService: MailService, auditService: AuditService, prisma: PrismaService, config: ConfigService, jwtService: JwtService, refreshTokenService: RefreshTokenService);
    register(dto: RegisterDto, ctx: RequestContext): Promise<{
        message: string;
        userId: string;
    }>;
    verifyEmail(dto: VerifyEmailDto, ctx: RequestContext): Promise<{
        message: string;
    }>;
    login(dto: LoginDto, ctx: RequestContext): Promise<{
        message: string;
        data: {
            accessToken: string;
            refreshToken: string;
            user: {
                id: string;
                firstName: string;
                lastName: string;
                email: string;
                role: import(".prisma/client").$Enums.Role;
            };
        };
    }>;
    refresh(rawToken: string, ctx: RequestContext): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
    logout(rawToken: string | undefined, all: boolean, userId: string, ctx: RequestContext): Promise<{
        message: string;
    }>;
    resendOtp(dto: ResendOtpDto, ctx: RequestContext): Promise<{
        message: string;
    }>;
    forgotPassword(dto: ForgotPasswordDto, ctx: RequestContext): Promise<{
        message: string;
    }>;
    resetPassword(dto: ResetPasswordDto, ctx: RequestContext): Promise<{
        message: string;
    }>;
    changePassword(userId: string, dto: ChangePasswordDto, ctx: RequestContext): Promise<{
        message: string;
    }>;
}
