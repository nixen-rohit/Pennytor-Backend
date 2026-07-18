import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { OtpService } from '../otp/otp.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
interface RequestContext {
    ipAddress?: string;
    userAgent?: string;
}
export declare class AuthService {
    private readonly usersService;
    private readonly otpService;
    private readonly mailService;
    private readonly auditService;
    private readonly config;
    private readonly logger;
    private readonly saltRounds;
    constructor(usersService: UsersService, otpService: OtpService, mailService: MailService, auditService: AuditService, config: ConfigService);
    register(dto: RegisterDto, ctx: RequestContext): Promise<{
        message: string;
        userId: string;
    }>;
    verifyEmail(dto: VerifyEmailDto, ctx: RequestContext): Promise<{
        message: string;
    }>;
    resendOtp(dto: ResendOtpDto, ctx: RequestContext): Promise<{
        message: string;
    }>;
}
export {};
