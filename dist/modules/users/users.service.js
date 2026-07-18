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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const prisma_service_1 = require("../../database/prisma.service");
const client_1 = require("@prisma/client");
let UsersService = class UsersService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    findByEmail(email) {
        return this.prisma.user.findUnique({
            where: { email: email.toLowerCase().trim() },
        });
    }
    findByReferralCode(code) {
        return this.prisma.user.findUnique({
            where: { ownReferralCode: code.toUpperCase().trim() },
        });
    }
    findById(id) {
        return this.prisma.user.findUnique({ where: { id } });
    }
    async createWithConsent(params) {
        const referralCode = await this.generateUniqueReferralCode();
        return this.prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    firstName: params.firstName,
                    lastName: params.lastName,
                    email: params.email.toLowerCase().trim(),
                    passwordHash: params.passwordHash,
                    ownReferralCode: referralCode,
                    referredBy: params.referredBy,
                },
            });
            await tx.userConsent.create({
                data: {
                    userId: user.id,
                    termsAccepted: true,
                    termsAcceptedAt: new Date(),
                    privacyPolicyAccepted: true,
                    privacyPolicyAcceptedAt: new Date(),
                    marketingEmails: params.marketingEmails,
                },
            });
            return user;
        });
    }
    markEmailVerified(userId) {
        return this.prisma.user.update({
            where: { id: userId },
            data: { emailVerified: true, status: 'ACTIVE' },
        });
    }
    async generateUniqueReferralCode() {
        for (let attempt = 0; attempt < 5; attempt++) {
            const code = (0, crypto_1.randomBytes)(4).toString('hex').toUpperCase();
            const existing = await this.prisma.user.findUnique({
                where: { ownReferralCode: code },
                select: { id: true },
            });
            if (!existing)
                return code;
        }
        throw new client_1.Prisma.PrismaClientKnownRequestError('Failed to generate a unique referral code after 5 attempts', { code: 'P2002', clientVersion: 'n/a' });
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], UsersService);
//# sourceMappingURL=users.service.js.map