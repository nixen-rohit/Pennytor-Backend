import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    register(dto: RegisterDto, req: Request): Promise<{
        message: string;
        userId: string;
    }>;
    checkEmail(email: string): Promise<{
        available: boolean;
    }>;
    login(dto: LoginDto, req: Request): Promise<{
        message: string;
        data: {
            accessToken: string;
            user: {
                id: string;
                firstName: string;
                lastName: string;
                email: string;
                role: import(".prisma/client").$Enums.Role;
            };
        };
    }>;
    verifyEmail(dto: VerifyEmailDto, req: Request): Promise<{
        message: string;
    }>;
    refresh(_dto: RefreshDto, req: Request): Promise<{
        statusCode: number;
        message: string;
        data?: undefined;
    } | {
        data: {
            accessToken: string;
        };
        statusCode?: undefined;
        message?: undefined;
    }>;
    logout(dto: LogoutDto, req: Request): Promise<{
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
    changePassword(dto: ChangePasswordDto, req: Request): Promise<{
        message: string;
    }>;
}
