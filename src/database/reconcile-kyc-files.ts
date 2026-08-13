/**
 * KYC file reconciliation / cleanup.
 *
 * Reports and (optionally) fixes two consistency gaps between the private
 * filesystem and PostgreSQL:
 *
 *   A. Metadata without a file  — KycFile rows whose physical file is
 *      missing from /var/private-storage. (Safe to delete: the bytes are
 *      gone already, the row is a lie.)
 *   B. Files without metadata   — physical files with no KycFile row.
 *      (Orphan uploads from a crash between disk write and DB insert.)
 *      Only removed with --prune-orphans.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/database/reconcile-kyc-files.ts
 *   npx ts-node -r tsconfig-paths/register src/database/reconcile-kyc-files.ts --prune
 *
 * On production run it from the app directory as the app user, ideally on a
 * schedule (cron: 03:10 daily) — see docs/kyc-storage-deployment.md.
 */
import 'dotenv/config';
import * as path from 'path';
import { promises as fs } from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const root = path.resolve(
  process.env.PRIVATE_STORAGE_PATH ?? '/var/private-storage',
);

async function main() {
  const prune = process.argv.includes('--prune');

  const rows = await prisma.kycFile.findMany({
    select: { id: true, storagePath: true, applicationId: true, type: true },
  });

  const missing: typeof rows = [];
  for (const row of rows) {
    const abs = path.resolve(root, row.storagePath);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      console.warn(
        `[SKIP] traversal-looking path in DB row ${row.id}: ${row.storagePath}`,
      );
      continue;
    }
    try {
      await fs.access(abs);
    } catch {
      missing.push(row);
    }
  }

  console.log(`Checked ${rows.length} metadata rows.`);
  console.log(`A. Rows without a physical file: ${missing.length}`);
  for (const row of missing) {
    console.log(
      `   - ${row.id} (${row.type}, app ${row.applicationId}) ${row.storagePath}`,
    );
    if (prune) {
      await prisma.kycFile.delete({ where: { id: row.id } });
      console.log(`     -> metadata deleted`);
    }
  }

  // B. physical files without metadata
  const kycDir = path.join(root, 'kyc');
  let orphans: string[] = [];
  try {
    const appDirs = await fs.readdir(kycDir);
    for (const appId of appDirs) {
      const appPath = path.join(kycDir, appId);
      let files: string[];
      try {
        files = await fs.readdir(appPath);
      } catch {
        continue;
      }
      for (const name of files) {
        const rel = path.posix.join('kyc', appId, name);
        const known = rows.some((r) => r.storagePath === rel);
        if (!known) orphans.push(path.join(appPath, name));
      }
    }
  } catch {
    // kyc dir doesn't exist yet — nothing to scan
  }

  console.log(`B. Physical files without metadata: ${orphans.length}`);
  for (const o of orphans) {
    console.log(`   - ${o}`);
    if (prune) {
      await fs.unlink(o);
      console.log(`     -> deleted`);
    }
  }

  console.log(
    prune ? 'Reconciliation applied.' : 'Dry run — pass --prune to apply.',
  );
  await prisma.$disconnect();
}

main()
  .catch((error) => {
    console.error('Reconciliation failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
