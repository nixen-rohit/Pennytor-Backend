import { randomBytes } from 'crypto';

export const CLIENT_ID_PATTERN = /^PNT-[A-Z0-9]{3}-[A-Z0-9]{3}$/;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomIndex(max: number): number {
  const limit = 256 - (256 % max);
  let value = 0;
  do {
    value = randomBytes(1)[0];
  } while (value >= limit);
  return value % max;
}

export function generateClientId(): string {
  // Format: PNT-ABC-123 (more readable with prefix and hyphens)
  let id = 'PNT-';
  for (let i = 0; i < 3; i++) {
    id += ALPHABET[randomIndex(ALPHABET.length)];
  }
  id += '-';
  for (let i = 0; i < 3; i++) {
    id += ALPHABET[randomIndex(ALPHABET.length)];
  }
  return id;
}
