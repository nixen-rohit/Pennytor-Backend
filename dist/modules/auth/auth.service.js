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
const bcrypt = require("bcrypt");
const crypto_1 = require("crypto");
const users_service_1 = require("../users/users.service");
const otp_service_1 = require("../otp/otp.service");
const mail_service_1 = require("../mail/mail.service");
const audit_service_1 = require("../audit/audit.service");
const prisma_service_1 = require("../../database/prisma.service");
let AuthService = AuthService_1 = class AuthService {
    constructor(usersService, otpService, mailService, auditService, prisma, config) {
        this.usersService = usersService;
        this.otpService = otpService;
        this.mailService = mailService;
        this.auditService = auditService;
        this.prisma = prisma;
        this.config = config;
        this.logger = new common_1.Logger(AuthService_1.name);
        this.saltRounds = this.config.get('BCRYPT_SALT_ROUNDS', 12);
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
                    expiresAt: new Date(Date.now() + 15 * 60_000),
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
        });
        await this.auditService.log({
            userId: user.id,
            action: 'PASSWORD_RESET_COMPLETED',
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        });
        return { message: 'Password reset successful. You can now log in.' };
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
        config_1.ConfigService])
], AuthService);
//# sourceMappingURL=auth.service.js.map