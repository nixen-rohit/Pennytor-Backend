import * as argon2 from 'argon2';
import * as bcrypt from 'bcrypt';

/**
 * Single source of truth for password hashing.
 *
 * New passwords are hashed with Argon2id (OWASP/Argon2 RFC 9106
 * recommendation: trade-off resistant, GPU-hostile). Parameters are the
 * OWASP Cheat Sheet defaults: timeCost=3, memoryCost=65536 KiB (64 MiB),
 * parallelism=4.
 *
 * Legacy hashes prefixed with `$2` (bcrypt) are still verified so existing
 * accounts keep working, but a successful login through a legacy hash
 * triggers automatic re-hash to Argon2id (see AuthService.login).
 */

const argon2Options: argon2.HashOptions = {
  type: argon2.argon2id,
  timeCost: 3,
  memoryCost: 65536,
  parallelism: 4,
  hashLength: 32,
};

export async function hashPassword(plain: string): Promise<string> {
  const hash = await argon2.hash(plain, argon2Options);
  return hash.toString();
}

type VerifyResult = { valid: boolean; needsRehash: boolean };

export async function verifyPassword(
  plain: string,
  storedHash: string,
): Promise<VerifyResult> {
  if (storedHash.startsWith('$argon2')) {
    const valid = await argon2.verify(storedHash, plain);
    return { valid, needsRehash: false };
  }

  if (storedHash.startsWith('$2')) {
    try {
      const valid = await bcrypt.compare(plain, storedHash);
      return { valid, needsRehash: valid };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  return { valid: false, needsRehash: false };
}