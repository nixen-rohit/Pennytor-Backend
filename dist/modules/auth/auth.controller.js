"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const swagger_1 = require("@nestjs/swagger");
const auth_service_1 = require("./auth.service");
const jwt_auth_guard_1 = require("./guards/jwt-auth.guard");
const register_dto_1 = require("./dto/register.dto");
const login_dto_1 = require("./dto/login.dto");
const verify_email_dto_1 = require("./dto/verify-email.dto");
const resend_otp_dto_1 = require("./dto/resend-otp.dto");
const forgot_password_dto_1 = require("./dto/forgot-password.dto");
const reset_password_dto_1 = require("./dto/reset-password.dto");
const refresh_dto_1 = require("./dto/refresh.dto");
const logout_dto_1 = require("./dto/logout.dto");
const change_password_dto_1 = require("./dto/change-password.dto");
const REFRESH_COOKIE = 'refresh_token';
const REFRESH_OPTIONS = {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/api/auth/refresh',
    maxAge: 30 * 24 * 60 * 60 * 1000,
};
let AuthController = class AuthController {
    constructor(authService) {
        this.authService = authService;
    }
    register(dto, req) {
        return this.authService.register(dto, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }
    async login(dto, req) {
        const ctx = {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        };
        const result = await this.authService.login(dto, ctx);
        const { refreshToken, ...rest } = result.data;
        const response = req.res;
        response.cookie(REFRESH_COOKIE, refreshToken, REFRESH_OPTIONS);
        return { message: result.message, data: rest };
    }
    verifyEmail(dto, req) {
        return this.authService.verifyEmail(dto, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }
    async refresh(_dto, req) {
        const rawToken = req.cookies?.[REFRESH_COOKIE];
        if (!rawToken) {
            return { statusCode: 401, message: 'Refresh token not provided' };
        }
        const ctx = {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        };
        const { accessToken, refreshToken } = await this.authService.refresh(rawToken, ctx);
        const response = req.res;
        response.cookie(REFRESH_COOKIE, refreshToken, REFRESH_OPTIONS);
        return { data: { accessToken } };
    }
    async logout(dto, req) {
        const rawToken = req.cookies?.[REFRESH_COOKIE];
        const user = req.user;
        const ctx = {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        };
        const result = await this.authService.logout(rawToken, dto.all === true, user.id, ctx);
        const response = req.res;
        response.clearCookie(REFRESH_COOKIE, { path: '/api/auth/refresh' });
        return result;
    }
    resendOtp(dto, req) {
        return this.authService.resendOtp(dto, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }
    forgotPassword(dto, req) {
        return this.authService.forgotPassword(dto, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }
    resetPassword(dto, req) {
        return this.authService.resetPassword(dto, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }
    changePassword(dto, req) {
        const user = req.user;
        return this.authService.changePassword(user.id, dto, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)('register'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60_000 } }),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new Pennytor account' }),
    (0, swagger_1.ApiBody)({ type: register_dto_1.RegisterDto }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Account created successfully' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'Email already registered' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [register_dto_1.RegisterDto, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "register", null);
__decorate([
    (0, common_1.Post)('login'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, throttler_1.Throttle)({ default: { limit: 10, ttl: 60_000 } }),
    (0, swagger_1.ApiOperation)({ summary: 'Log into an existing account' }),
    (0, swagger_1.ApiBody)({ type: login_dto_1.LoginDto }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Login successful' }),
    (0, swagger_1.ApiResponse)({
        status: 401,
        description: 'Invalid credentials / Unverified email / Locked',
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [login_dto_1.LoginDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, common_1.Post)('verify-email'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, throttler_1.Throttle)({ default: { limit: 10, ttl: 60_000 } }),
    (0, swagger_1.ApiOperation)({ summary: 'Verify a newly created account via emailed OTP' }),
    (0, swagger_1.ApiBody)({ type: verify_email_dto_1.VerifyEmailDto }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Email verified successfully' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [verify_email_dto_1.VerifyEmailDto, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "verifyEmail", null);
__decorate([
    (0, common_1.Post)('refresh'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, throttler_1.Throttle)({ default: { limit: 10, ttl: 60_000 } }),
    (0, swagger_1.ApiOperation)({
        summary: 'Refresh access token using the HttpOnly refresh token cookie',
        description: 'The refresh token is read from the "refresh_token" HttpOnly cookie, never from the request body.',
    }),
    (0, swagger_1.ApiBody)({ type: refresh_dto_1.RefreshDto }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Tokens refreshed' }),
    (0, swagger_1.ApiResponse)({ status: 401, description: 'Invalid or expired refresh token' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [refresh_dto_1.RefreshDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "refresh", null);
__decorate([
    (0, common_1.Post)('logout'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, throttler_1.Throttle)({ default: { limit: 10, ttl: 60_000 } }),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({
        summary: 'Log out the current session (or all sessions)',
        description: 'Requires a valid access token in the Authorization header. ' +
            'Set body.all = true to revoke every session for this user.',
    }),
    (0, swagger_1.ApiBody)({ type: logout_dto_1.LogoutDto }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Logged out' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [logout_dto_1.LogoutDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
__decorate([
    (0, common_1.Post)('resend-otp'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, throttler_1.Throttle)({ default: { limit: 3, ttl: 60_000 } }),
    (0, swagger_1.ApiOperation)({ summary: 'Resend email verification OTP' }),
    (0, swagger_1.ApiBody)({ type: resend_otp_dto_1.ResendOtpDto }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'OTP resent or silently ignored' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [resend_otp_dto_1.ResendOtpDto, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "resendOtp", null);
__decorate([
    (0, common_1.Post)('forgot-password'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, throttler_1.Throttle)({ default: { limit: 3, ttl: 60_000 } }),
    (0, swagger_1.ApiOperation)({ summary: 'Request a password reset link' }),
    (0, swagger_1.ApiBody)({ type: forgot_password_dto_1.ForgotPasswordDto }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Generic success message' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [forgot_password_dto_1.ForgotPasswordDto, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "forgotPassword", null);
__decorate([
    (0, common_1.Post)('reset-password'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60_000 } }),
    (0, swagger_1.ApiOperation)({ summary: 'Set a new password using a reset token' }),
    (0, swagger_1.ApiBody)({ type: reset_password_dto_1.ResetPasswordDto }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Password reset successful' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Invalid or expired reset link' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [reset_password_dto_1.ResetPasswordDto, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "resetPassword", null);
__decorate([
    (0, common_1.Post)('change-password'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60_000 } }),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({
        summary: 'Change password for the authenticated user',
        description: 'Requires a valid access token. Revokes all other sessions on success.',
    }),
    (0, swagger_1.ApiBody)({ type: change_password_dto_1.ChangePasswordDto }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Password changed' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Current password is incorrect' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [change_password_dto_1.ChangePasswordDto, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "changePassword", null);
exports.AuthController = AuthController = __decorate([
    (0, swagger_1.ApiTags)('auth'),
    (0, common_1.Controller)('auth'),
    __metadata("design:paramtypes", [auth_service_1.AuthService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map