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
var MailService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const handlebars = require("handlebars");
const fs_1 = require("fs");
const path_1 = require("path");
const BREVO_SEND_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
let MailService = MailService_1 = class MailService {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(MailService_1.name);
        this.templateCache = new Map();
        this.apiKey = this.config.get('BREVO_API_KEY');
        this.fromAddress = this.config.get('MAIL_FROM');
        this.fromName = this.config.get('MAIL_FROM_NAME', 'Pennytor');
    }
    async sendVerificationEmail(params) {
        const html = this.renderTemplate('verify-email', {
            firstName: params.firstName,
            otp: params.otp,
            expiryMinutes: this.config.get('OTP_EXPIRY_MINUTES', 5),
        });
        await this.send({
            to: params.to,
            subject: 'Verify your Pennytor account',
            html,
        });
    }
    async sendPasswordResetEmail(params) {
        const frontendUrl = this.config.get('FRONTEND_URL');
        const resetLink = `${frontendUrl}/reset-password?token=${params.token}&email=${encodeURIComponent(params.email)}`;
        const html = this.renderTemplate('reset-password', {
            firstName: params.firstName,
            resetLink,
            expiryMinutes: 15,
        });
        await this.send({
            to: params.to,
            subject: 'Reset your Pennytor password',
            html,
        });
    }
    async send(params) {
        try {
            const response = await fetch(BREVO_SEND_ENDPOINT, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'api-key': this.apiKey,
                },
                body: JSON.stringify({
                    sender: { email: this.fromAddress, name: this.fromName },
                    to: [{ email: params.to }],
                    subject: params.subject,
                    htmlContent: params.html,
                }),
            });
            if (!response.ok) {
                const body = await response.text();
                throw new Error(`Brevo API responded with ${response.status}: ${body}`);
            }
        }
        catch (error) {
            this.logger.error(`Failed to send email to ${params.to}`, error instanceof Error ? error.stack : String(error));
            throw error;
        }
    }
    renderTemplate(name, context) {
        let template = this.templateCache.get(name);
        if (!template) {
            const source = (0, fs_1.readFileSync)((0, path_1.join)(__dirname, 'templates', `${name}.hbs`), 'utf-8');
            template = handlebars.compile(source);
            this.templateCache.set(name, template);
        }
        return template(context);
    }
};
exports.MailService = MailService;
exports.MailService = MailService = MailService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], MailService);
//# sourceMappingURL=mail.service.js.map