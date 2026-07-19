import { PrismaService } from '../../database/prisma.service';
import { User } from '@prisma/client';
export declare class UsersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
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
    private generateUniqueReferralCode;
}
