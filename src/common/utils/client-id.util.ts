import { randomBytes } from 'crypto';

export const CLIENT_ID_PATTERN = /^[A-Z0-9]{6,9}$/;

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
  const length = 6 + randomIndex(4);
  let id = '';
  for (let i = 0; i < length; i++) {
    id += ALPHABET[randomIndex(ALPHABET.length)];
  }
  return id;
}
