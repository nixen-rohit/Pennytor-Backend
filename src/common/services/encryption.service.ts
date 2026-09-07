import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decryptField,
  deriveEncryptionKey,
  encryptField,
} from '../utils/encryption.util';

/**
 * AES-256-GCM encryption for KYC identifiers. The admin review flow NEEDS
 * the full values to verify against the uploaded documents, so the
 * ciphertext is stored at rest and decrypted ONLY in the ADMIN
 * application-detail path (KycService.getApplicationDetail, protected by
 * SessionAuthGuard + RolesGuard). Nothing else ever decrypts; the key comes
 * ONLY from the DATA_ENCRYPTION_KEY environment variable. Users see only
 * the last-4 masks stored alongside.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const hexKey = config.get<string>('DATA_ENCRYPTION_KEY', '');
    this.key = deriveEncryptionKey(hexKey);
  }

  encrypt(plaintext: string): string {
    return encryptField(plaintext, this.key);
  }

  /**
   * Decrypts a field. GCM authenticates the ciphertext, so a tampered value
   * fails here (thrown) instead of returning garbage.
   */
  decrypt(ciphertext: string): string {
    return decryptField(ciphertext, this.key);
  }
}
