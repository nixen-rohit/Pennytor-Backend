import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

/**
 * Pure AES-256-GCM helpers. The key is supplied by the caller (EncryptionService
 * loads it from DATA_ENCRYPTION_KEY) so these functions stay side-effect free
 * and unit-testable.
 *
 * Ciphertext envelope: `v1.<iv base64>.<authTag base64>.<ciphertext base64>`
 * — GCM authenticates the ciphertext, so a tampered database value fails
 * decryption instead of silently corrupting.
 */

export const ENCRYPTION_VERSION = 'v1';

export function deriveEncryptionKey(hexKey: string): Buffer {
  if (!hexKey || !/^[0-9a-f]{64}$/i.test(hexKey)) {
    throw new Error(
      'DATA_ENCRYPTION_KEY must be a 64-character hex string (32 bytes, AES-256). Generate with: openssl rand -hex 32',
    );
  }
  return Buffer.from(hexKey, 'hex');
}

export function encryptField(plaintext: string, key: Buffer): string {
  if (!plaintext) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

export function decryptField(payload: string, key: Buffer): string {
  if (!payload) return '';
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION) {
    throw new Error('Unsupported or malformed ciphertext envelope');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Compares two buffers in constant time — used when verifying keys. */
export function safeBufferEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}