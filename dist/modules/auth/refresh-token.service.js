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
var RefreshTokenService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RefreshTokenService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../../database/prisma.service");
const audit_service_1 = require("../audit/audit.service");
const crypto_1 = require("crypto");
let RefreshTokenService = RefreshTokenService_1 = class RefreshTokenService {
    constructor(prisma, config, auditService) {
        this.prisma = prisma;
        this.config = config;
        this.auditService = auditService;
        this.logger = new common_1.Logger(RefreshTokenService_1.name);
        this.expiryDays = this.config.get('JWT_REFRESH_EXPIRY_DAYS', 30);
    }
    async create(userId, ctx) {
        const rawToken = (0, crypto_1.randomBytes)(64).toString('hex');
        const tokenHash = RefreshTokenService_1.hashToken(rawToken);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + this.expiryDays);
        await this.prisma.refreshToken.create({
            data: {
                userId,
                tokenHash,
                expiresAt,
                ipAddress: ctx.ipAddress,
                userAgent: ctx.userAgent,
            },
        });
        return rawToken;
    }
    async validateAndRotate(rawToken, ctx) {
        const tokenHash = RefreshTokenService_1.hashToken(rawToken);
        const token = await this.prisma.refreshToken.findUnique({
            where: { tokenHash },
            select: {
                id: true,
                userId: true,
                expiresAt: true,
                revokedAt: true,
            },
        });
        if (!token) {
            throw new common_1.UnauthorizedException('Invalid refresh token');
        }
        if (token.revokedAt) {
            await this.handleTheftDetection(token.userId, token.id, ctx);
            throw new common_1.UnauthorizedException('Session revoked — please log in again');
        }
        if (token.expiresAt <= new Date()) {
            throw new common_1.UnauthorizedException('Refresh token expired');
        }
        const newRawToken = (0, crypto_1.randomBytes)(64).toString('hex');
        const newTokenHash = RefreshTokenService_1.hashToken(newRawToken);
        const newExpiresAt = new Date();
        newExpiresAt.setDate(newExpiresAt.getDate() + this.expiryDays);
        await this.prisma.$transaction(async (tx) => {
            const newToken = await tx.refreshToken.create({
                data: {
                    userId: token.userId,
                    tokenHash: newTokenHash,
                    expiresAt: newExpiresAt,
                    ipAddress: ctx.ipAddress,
                    userAgent: ctx.userAgent,
                },
            });
            await tx.refreshToken.update({
                where: { id: token.id },
                data: {
                    revokedAt: new Date(),
                    replacedByTokenId: newToken.id,
                },
            });
        });
        await this.auditService.log({
            userId: token.userId,
            action: 'TOKEN_REFRESHED',
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        });
        return { rawToken: newRawToken, userId: token.userId };
    }
    async handleTheftDetection(userId, tokenId, ctx) {
        this.logger.warn(`Refresh token reuse detected for user ${userId} — revoking all sessions`);
        await this.prisma.refreshToken.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        await this.auditService.log({
            userId,
            action: 'TOKEN_REUSE_DETECTED',
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            metadata: { revokedTokenId: tokenId },
        });
    }
    async revoke(rawToken) {
        const tokenHash = RefreshTokenService_1.hashToken(rawToken);
        const token = await this.prisma.refreshToken.findUnique({
            where: { tokenHash },
            select: { id: true, revokedAt: true },
        });
        if (!token || token.revokedAt)
            return;
        await this.prisma.refreshToken.update({
            where: { id: token.id },
            data: { revokedAt: new Date() },
        });
    }
    async revokeAllForUser(userId) {
        await this.prisma.refreshToken.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
    }
    static hashToken(rawToken) {
        return (0, crypto_1.createHash)('sha256').update(rawToken).digest('hex');
    }
};
exports.RefreshTokenService = RefreshTokenService;
exports.RefreshTokenService = RefreshTokenService = RefreshTokenService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        audit_service_1.AuditService])
], RefreshTokenService);
//# sourceMappingURL=refresh-token.service.js.map