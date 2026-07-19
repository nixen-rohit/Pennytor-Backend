import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    register(dto: RegisterDto, req: Request): Promise<{
        message: string;
        userId: string;
    }>;
    verifyEmail(dto: VerifyEmailDto, req: Request): Promise<{
        message: string;
    }>;
    resendOtp(dto: ResendOtpDto, req: Request): Promise<{
        message: string;
    }>;
    forgotPassword(dto: ForgotPasswordDto, req: Request): Promise<{
        message: string;
    }>;
    resetPassword(dto: ResetPasswordDto, req: Request): Promise<{
        message: string;
    }>;
}
