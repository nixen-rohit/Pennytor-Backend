import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { generateReferralCode } from '@common/utils/referral-code.util';

const prisma = new PrismaClient();

async function generateUniqueReferralCode(
  codesInUse: Set<string>,
): Promise<string> {
  let code = generateReferralCode();
  while (codesInUse.has(code)) {
    code = generateReferralCode();
  }
  codesInUse.add(code);
  return code;
}

async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@pennytor.com')
    .toLowerCase()
    .trim();
  const password = process.env.ADMIN_PASSWORD || 'Admin@1234';
  const firstName = process.env.ADMIN_FIRST_NAME || 'Admin';
  const lastName = process.env.ADMIN_LAST_NAME || 'Pennytor';
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });

  if (existing) {
    console.log(`Admin already exists (${email}). Skipping creation.`);
    return;
  }

  const users = await prisma.user.findMany({
    select: { ownReferralCode: true },
  });
  const codesInUse = new Set(users.map((u) => u.ownReferralCode));

  const passwordHash = await bcrypt.hash(password, saltRounds);
  const ownReferralCode = await generateUniqueReferralCode(codesInUse);

  const admin = await prisma.user.create({
    data: {
      firstName,
      lastName,
      email,
      passwordHash,
      role: Role.ADMIN,
      ownReferralCode,
      emailVerified: true,
      status: 'ACTIVE',
    },
    select: { email: true, ownReferralCode: true },
  });

  console.log(`Created admin: ${admin.email}`);
  console.log(`Admin referral code: ${admin.ownReferralCode}`);
}

async function main() {
  console.log('Seeding database...');

  await seedAdmin();

  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
