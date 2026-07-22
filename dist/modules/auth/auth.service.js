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
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const bcrypt = require("bcrypt");
const crypto_1 = require("crypto");
const users_service_1 = require("../users/users.service");
const otp_service_1 = require("../otp/otp.service");
const mail_service_1 = require("../mail/mail.service");
const audit_service_1 = require("../audit/audit.service");
const refresh_token_service_1 = require("./refresh-token.service");
const prisma_service_1 = require("../../database/prisma.service");
let AuthService = AuthService_1 = class AuthService {
    constructor(usersService, otpService, mailService, auditService, prisma, config, jwtService, refreshTokenService) {
        this.usersService = usersService;
        this.otpService = otpService;
        this.mailService = mailService;
        this.auditService = auditService;
        this.prisma = prisma;
        this.config = config;
        this.jwtService = jwtService;
        this.refreshTokenService = refreshTokenService;
        this.logger = new common_1.Logger(AuthService_1.name);
        this.saltRounds = this.config.get('BCRYPT_SALT_ROUNDS', 12);
        this.accessExpiry = this.config.get('JWT_ACCESS_EXPIRY', '15m');
        this.resetExpiryMinutes = this.config.get('PASSWORD_RESET_EXPIRY_MINUTES', 15);
    }
    async register(dto, ctx) {
        const existingUser = await this.usersService.findByEmail(dto.email);
        if (existingUser) {
            await this.auditService.log({
                action: 'REGISTER_FAILED',
                ipAddress: ctx.ipAddress,
                userAgent: ctx.userAgent,
                metadata: { reason: 'email_already_registered' },
            });
            throw new common_1.ConflictException('If this email is available, you will receive a confirmation shortly.');
        }
        let referredByUserId;
        if (dto.referralCode) {
            const referrer = await this.usersService.findByReferralCode(dto.referralCode);
            referredByUserId = referrer?.id;
        }
        const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);
        const user = await this.usersService.createWithConsent({
            firstName: dto.firstName,
            lastName: dto.lastName,
            email: dto.email,
            passwordHash,
            referredBy: referredByUserId,
            marketingEmails: dto.marketingEmails ?? false,
        });
        const otp = await this.otpService.generate(user.id, 'EMAIL_VERIFY');
        try {
            await this.mailService.sendVerificationEmail({
                to: user.email,
                firstName: user.firstName,
                otp,
            });
        }
        catch (error) {
            this.logger.error(`Verification email failed to send for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
        }
        await this.auditService.log({
            userId: user.id,
            action: 'REGISTER',
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        });
        return {
            message: 'Registration successful. Please verify your email.',
            userId: user.id,
        };
    }
    async verifyEmail(dto, ctx) {
        const user = await this.usersService.findByEmail(dto.email);
        if (!user) {
            throw new common_1.ConflictException('Invalid or expired verification code');
        }
        await this.otpService.verify(user.id, 'EMAIL_VERIFY', dto.otp);
        await this.usersService.markEmailVerified(user.id);
        await this.auditService.log({
            userId: user.id,
            action: 'EMAIL_VERIFIED',
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        });
        return { message: 'Email verified successfully.' };
    }
    async login(dto, ctx) {
        const user = await this.usersService.findByEmail(dto.email);
        if (!user) {
            await this.auditService.log({
                action: 'LOGIN_FAILED',
                ipAddress: ctx.ipAddress,
                userAgent: ctx.userAgent,
                metadata: { reason: 'user_not_found', email: dto.email },
            });
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        if (user.lockedUntil && user.lockedUntil > new Date()) {
            throw new common_1.UnauthorizedException('Account is locked. Please try again later.');
        }
        const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
        if (!isPasswordValid) {
            const attempts = (user.failedLoginAttempts || 0) + 1;
            const lockTimeMinutes = attempts >= 5 ? 15 : undefined;
            await this.usersService.recordFailedLogin(user.id, attempts, lockTimeMinutes);
            await this.auditService.log({
                userId: user.id,
                action: 'LOGIN_FAILED',
                ipAddress: ctx.ipAddress,
                userAgent: ctx.userAgent,
                metadata: { reason: 'invalid_password', attempts },
            });
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        if (!user.emailVerified) {
            throw new common_1.UnauthorizedException('Please verify your email address before logging in.');
        }
        await this.usersService.recordSuccessfulLogin(user.id);
        await this.auditService.log({
            userId: user.id,
            action: 'LOGIN_SUCCESS',
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        });
        const payload = { sub: user.id, role: user.role };
        const accessToken = await this.jwtService.signAsync(payload, {
            expiresIn: this.accessExpiry,
        });
        const refreshToken = await this.refreshTokenService.create(user.id, ctx);
        return {
            message: 'Login successful',
            data: {
                accessToken,
                refreshToken,
                user: {
                    id: user.id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    role: user.role,
                },
            },
        };
    }
    async refresh(rawToken, ctx) {
        const { rawToken: newRefreshToken, userId } = await this.refreshTokenService.validateAndRotate(rawToken, ctx);
        const user = await this.usersService.findById(userId);
        if (!user) {
            throw new common_1.UnauthorizedException('User not found');
        }
        const payload = { sub: user.id, role: user.role };
        const accessToken = await this.jwtService.signAsync(payload, {
            expiresIn: this.accessExpiry,
        });
        return { accessToken, refreshToken: newRefreshToken };
    }
    async logout(rawToken, all, userId, ctx) {
        if (all) {
            await this.refreshTokenService.revokeAllForUser(userId);
            await this.auditService.log({
                userId,
                action: 'LOGOUT_ALL',
                ipAddress: ctx.ipAddress,
                userAgent: ctx.userAgent,
            });
            return { message: 'Logged out of all sessions.' };
        }
        await this.refreshTokenService.revoke(rawToken);
        await this.auditService.log({
            userId,
            action: 'LOGOUT',
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        });
        return { message: 'Logged out successfully.' };
    }
    async resendOtp(dto, ctx) {
        const user = await this.usersService.findByEmail(dto.email);
        if (!user || user.emailVerified) {
            return {
                message: 'If this email is registered and unverified, a new code has been sent.',
            };
        }
        const otp = await this.otpService.generate(user.id, 'EMAIL_VERIFY');
        try {
            await this.mailService.sendVerificationEmail({
                to: user.email,
                firstName: user.firstName,
                otp,
            });
        }
        catch (error) {
            this.logger.error(`Resend OTP email failed for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
        }
        await this.auditService.log({
            userId: user.id,
            action: 'OTP_RESENT',
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        });
        return {
            message: 'If this email is registered and unverified, a new code has been sent.',
        };
    }
    async forgotPassword(dto, ctx) {
        const user = await this.usersService.findByEmail(dto.email);
        if (user && user.status === 'ACTIVE') {
            await this.prisma.passwordResetToken.updateMany({
                where: { userId: user.id, consumedAt: null },
                data: { consumedAt: new Date() },
            });
            const rawToken = (0, crypto_1.randomBytes)(32).toString('hex');
            const tokenHash = await bcrypt.hash(rawToken, this.saltRounds);
            await this.prisma.passwordResetToken.create({
                data: {
                    userId: user.id,
                    tokenHash,
                    expiresAt: new Date(Date.now() + this.resetExpiryMinutes * 60_000),
                },
            });
            try {
                await this.mailService.sendPasswordResetEmail({
                    to: user.email,
                    firstName: user.firstName,
                    token: rawToken,
                    email: user.email,
                });
            }
            catch (error) {
                this.logger.error(`Password reset email failed to send for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
            }
            await this.auditService.log({
                userId: user.id,
                action: 'PASSWORD_RESET_REQUESTED',
                ipAddress: ctx.ipAddress,
                userAgent: ctx.userAgent,
            });
        }
        else {
            await this.auditService.log({
                action: 'PASSWORD_RESET_REQUESTED',
                ipAddress: ctx.ipAddress,
                userAgent: ctx.userAgent,
            });
        }
        return {
            message: "If this email is registered, you'll receive a reset link shortly.",
        };
    }
    async resetPassword(dto, ctx) {
        const user = await this.usersService.findByEmail(dto.email);
        if (!user) {
            throw new common_1.BadRequestException('Invalid or expired reset link');
        }
        const resetToken = await this.prisma.passwordResetToken.findFirst({
            where: { userId: user.id, consumedAt: null },
            orderBy: { createdAt: 'desc' },
        });
        if (!resetToken) {
            throw new common_1.BadRequestException('Invalid or expired reset link');
        }
        if (resetToken.expiresAt < new Date()) {
            throw new common_1.BadRequestException('Invalid or expired reset link');
        }
        const tokenValid = await bcrypt.compare(dto.token, resetToken.tokenHash);
        if (!tokenValid) {
            throw new common_1.BadRequestException('Invalid or expired reset link');
        }
        const passwordHash = await bcrypt.hash(dto.newPassword, this.saltRounds);
        await this.prisma.$transaction(async (tx) => {
            await tx.passwordResetToken.update({
                where: { id: resetToken.id },
                data: { consumedAt: new Date() },
            });
            await tx.user.update({
                where: { id: user.id },
                data: { passwordHash },
            });
            await tx.refreshToken.updateMany({
                where: { userId: user.id, revokedAt: null },
                data: { revokedAt: new Date() },
            });
        });
        await this.auditService.log({
            userId: user.id,
            action: 'PASSWORD_RESET_COMPLETED',
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        });
        return { message: 'Password reset successful. You can now log in.' };
    }
    async changePassword(userId, dto, ctx) {
        const user = await this.usersService.findById(userId);
        if (!user) {
            throw new common_1.UnauthorizedException('User not found');
        }
        const isPasswordValid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
        if (!isPasswordValid) {
            throw new common_1.BadRequestException('Current password is incorrect');
        }
        const passwordHash = await bcrypt.hash(dto.newPassword, this.saltRounds);
        await this.prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: userId },
                data: { passwordHash },
            });
            await tx.refreshToken.updateMany({
                where: { userId, revokedAt: null },
                data: { revokedAt: new Date() },
            });
        });
        await this.auditService.log({
            userId,
            action: 'PASSWORD_CHANGED',
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        });
        return { message: 'Password changed successfully. Please log in again.' };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [users_service_1.UsersService,
        otp_service_1.OtpService,
        mail_service_1.MailService,
        audit_service_1.AuditService,
        prisma_service_1.PrismaService,
        config_1.ConfigService,
        jwt_1.JwtService,
        refresh_token_service_1.RefreshTokenService])
], AuthService);
//# sourceMappingURL=auth.service.js.map