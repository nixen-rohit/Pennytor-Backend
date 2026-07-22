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
exports.OtpService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const bcrypt = require("bcrypt");
const crypto_1 = require("crypto");
const prisma_service_1 = require("../../database/prisma.service");
let OtpService = class OtpService {
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
        this.expiryMinutes = this.config.get('OTP_EXPIRY_MINUTES', 5);
        this.maxAttempts = this.config.get('OTP_MAX_ATTEMPTS', 5);
        this.length = this.config.get('OTP_LENGTH', 6);
        this.saltRounds = this.config.get('BCRYPT_SALT_ROUNDS', 12);
    }
    async generate(userId, purpose) {
        await this.prisma.otp.updateMany({
            where: { userId, purpose, consumedAt: null },
            data: { consumedAt: new Date() },
        });
        const plainOtp = this.generateNumericCode(this.length);
        const otpHash = await bcrypt.hash(plainOtp, this.saltRounds);
        await this.prisma.otp.create({
            data: {
                userId,
                purpose,
                otpHash,
                expiresAt: new Date(Date.now() + this.expiryMinutes * 60_000),
                maxAttempts: this.maxAttempts,
            },
        });
        return plainOtp;
    }
    async verify(userId, purpose, submittedOtp) {
        const otp = await this.prisma.otp.findFirst({
            where: { userId, purpose, consumedAt: null },
            orderBy: { createdAt: 'desc' },
        });
        if (!otp) {
            throw new common_1.BadRequestException('No active verification code found');
        }
        if (otp.expiresAt < new Date()) {
            throw new common_1.BadRequestException('Verification code has expired');
        }
        if (otp.attempts >= otp.maxAttempts) {
            throw new common_1.BadRequestException('Too many incorrect attempts. Request a new code.');
        }
        const isValid = await bcrypt.compare(submittedOtp, otp.otpHash);
        if (!isValid) {
            await this.prisma.otp.update({
                where: { id: otp.id },
                data: { attempts: { increment: 1 } },
            });
            throw new common_1.BadRequestException('Incorrect verification code');
        }
        await this.prisma.otp.update({
            where: { id: otp.id },
            data: { consumedAt: new Date() },
        });
    }
    generateNumericCode(length) {
        const min = 10 ** (length - 1);
        const max = 10 ** length - 1;
        return (0, crypto_1.randomInt)(min, max + 1).toString();
    }
};
exports.OtpService = OtpService;
exports.OtpService = OtpService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], OtpService);
//# sourceMappingURL=otp.service.js.map