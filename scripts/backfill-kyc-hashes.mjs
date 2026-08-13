/**
 * One-off backfill: decrypts the legacy AES-256-GCM KYC values, hashes them
 * with argon2id (same params as HashService), writes the hash + last4 into
 * the new columns, and deletes the leftover fake-data test application.
 * Run with: node scripts/backfill-kyc-hashes.mjs  (node 20+ for argon2? no —
 * this uses the backend's own @node-rs/argon2 + dotenv)
 */
import { createDecipheriv } from 'crypto';
import { createRequire } from 'module';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname });

const require = createRequire(import.meta.url);
const { hash, Algorithm } = require('@node-rs/argon2');

const p = new PrismaClient();

const hexKey = process.env.DATA_ENCRYPTION_KEY ?? '';
if (!/^[0-9a-f]{64}$/i.test(hexKey)) {
  console.error('DATA_ENCRYPTION_KEY missing/invalid in backend/.env');
  process.exit(1);
}
const key = Buffer.from(hexKey, 'hex');

function decrypt(payload) {
  if (!payload || payload === '') return '';
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
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

const HASH_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};
const last4 = (v) => v.slice(-4);

async function main() {
  // Raw select: the regenerated client refuses to map rows whose new
  // NOT NULL hash columns are still NULL mid-migration.
  const apps = await p.$queryRaw`
    SELECT id, "userId", "aadhaarNumber", "panNumber", "accountNumber",
           "ifscCode", "nomineeAadhaar"
    FROM "kyc_applications"`;
  console.log(`rows: ${apps.length}`);

  for (const app of apps) {
    const email =
      (await p.user.findUnique({ where: { id: app.userId } }))?.email ?? '';
    if (/^detail-test-/.test(email)) {
      console.log(`deleting leftover test app ${app.id} (${email})`);
      await p.$executeRaw`DELETE FROM "kyc_applications" WHERE id = ${app.id}`;
      continue;
    }

    let aadhaar, account, nominee;
    try {
      aadhaar = decrypt(app.aadhaarNumber);
      account = decrypt(app.accountNumber);
      nominee = decrypt(app.nomineeAadhaar);
    } catch (e) {
      console.error(`decrypt failed for ${app.id} (${email}):`, e.message);
      process.exit(1);
    }

    await p.kycApplication.update({
      where: { id: app.id },
      data: {
        aadhaarNumberHash: await hash(aadhaar, HASH_OPTS),
        aadhaarNumberLast4: last4(aadhaar),
        panNumberHash: await hash(app.panNumber, HASH_OPTS),
        panNumberLast4: last4(app.panNumber),
        accountNumberHash: await hash(account, HASH_OPTS),
        accountNumberLast4: last4(account),
        ifscCodeHash: await hash(app.ifscCode, HASH_OPTS),
        ifscCodeLast4: last4(app.ifscCode),
        nomineeAadhaarHash: await hash(nominee, HASH_OPTS),
        nomineeAadhaarLast4: last4(nominee),
      },
    });
    console.log(`migrated ${app.id} (${email})`);
  }

  await p.$disconnect();
  console.log('done');
}

main().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});