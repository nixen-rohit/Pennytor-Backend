import { PrismaService } from '../../database/prisma.service';
import { User } from '@prisma/client';
import { MailService } from '../mail/mail.service';
export declare class UsersService {
    private readonly prisma;
    private readonly mailService;
    constructor(prisma: PrismaService, mailService: MailService);
    findByEmail(email: string): Promise<User | null>;
    findByReferralCode(code: string): Promise<User | null>;
    findById(id: string): Promise<User | null>;
    createWithConsent(params: {
        firstName: string;
        lastName: string;
        email: string;
        passwordHash: string;
        referredBy?: string;
        marketingEmails: boolean;
    }): Promise<User>;
    markEmailVerified(userId: string): Promise<User>;
    updatePasswordHash(userId: string, passwordHash: string): Promise<User>;
    recordSuccessfulLogin(userId: string): Promise<User>;
    recordFailedLogin(userId: string, attempts: number, lockTimeMinutes?: number): Promise<User>;
    private generateUniqueReferralCode;
    approveUser(userId: string): Promise<{
        message: string;
        clientId: string | null;
    }>;
    private generateUniqueClientId;
}
