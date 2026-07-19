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
const register_dto_1 = require("./dto/register.dto");
const verify_email_dto_1 = require("./dto/verify-email.dto");
const resend_otp_dto_1 = require("./dto/resend-otp.dto");
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
    verifyEmail(dto, req) {
        return this.authService.verifyEmail(dto, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }
    resendOtp(dto, req) {
        return this.authService.resendOtp(dto, {
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
    (0, swagger_1.ApiOperation)({
        summary: 'Create a new Pennytor account',
        description: 'Register a new user account. A verification email with an OTP will be sent. ' +
            'Rate limit: 5 requests per 60 seconds.',
    }),
    (0, swagger_1.ApiBody)({ type: register_dto_1.RegisterDto }),
    (0, swagger_1.ApiResponse)({
        status: 201,
        description: 'Account created successfully. Verification email sent.',
        schema: {
            example: {
                message: 'If this email is available, you will receive a confirmation shortly.',
                userId: 'clx1234567890abcdef',
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 409,
        description: 'Email already registered',
        schema: {
            example: {
                statusCode: 409,
                path: '/api/auth/register',
                timestamp: '2025-01-01T00:00:00.000Z',
                message: 'If this email is available, you will receive a confirmation shortly.',
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 429,
        description: 'Too many registration attempts',
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [register_dto_1.RegisterDto, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "register", null);
__decorate([
    (0, common_1.Post)('verify-email'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, throttler_1.Throttle)({ default: { limit: 10, ttl: 60_000 } }),
    (0, swagger_1.ApiOperation)({
        summary: 'Verify a newly created account via emailed OTP',
        description: 'Confirm the email address by submitting the 6-digit OTP. ' +
            'Rate limit: 10 requests per 60 seconds.',
    }),
    (0, swagger_1.ApiBody)({ type: verify_email_dto_1.VerifyEmailDto }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Email verified successfully',
        schema: {
            example: {
                message: 'Email verified successfully',
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        description: 'Invalid, expired, or exhausted OTP',
        schema: {
            example: {
                statusCode: 400,
                path: '/api/auth/verify-email',
                timestamp: '2025-01-01T00:00:00.000Z',
                message: 'Incorrect verification code',
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 429,
        description: 'Too many verification attempts',
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [verify_email_dto_1.VerifyEmailDto, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "verifyEmail", null);
__decorate([
    (0, common_1.Post)('resend-otp'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, throttler_1.Throttle)({ default: { limit: 3, ttl: 60_000 } }),
    (0, swagger_1.ApiOperation)({
        summary: 'Resend email verification OTP',
        description: 'Request a new OTP to be sent to the email address. ' +
            'Returns 200 even if the email is not found (enumeration-safe). ' +
            'Rate limit: 3 requests per 60 seconds.',
    }),
    (0, swagger_1.ApiBody)({ type: resend_otp_dto_1.ResendOtpDto }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'OTP resent (or silently ignored if email not found)',
        schema: {
            example: {
                message: 'If this email is registered, a new code has been sent.',
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 429,
        description: 'Too many resend requests',
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [resend_otp_dto_1.ResendOtpDto, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "resendOtp", null);
exports.AuthController = AuthController = __decorate([
    (0, swagger_1.ApiTags)('auth'),
    (0, common_1.Controller)('auth'),
    __metadata("design:paramtypes", [auth_service_1.AuthService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map