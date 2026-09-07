import { BadRequestException } from '@nestjs/common';
import * as path from 'path';

/**
 * Filesystem-safety helpers for the private storage directory.
 *
 * Every path handed to the filesystem is derived from values that came out
 * of PostgreSQL (application id, storage name) rather than from the client —
 * and is then re-verified against the configured root so a corrupted row or
 * a crafted id can never escape PRIVATE_STORAGE_PATH.
 */

/** Storage names are always a UUID + whitelisted extension. */
const STORAGE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/;

export function assertSafeStorageName(storageName: string): void {
  if (!STORAGE_NAME_PATTERN.test(storageName)) {
    throw new BadRequestException('Invalid storage name');
  }
}

export function assertSafeApplicationId(applicationId: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(applicationId)) {
    throw new BadRequestException('Invalid application id');
  }
}

/** Relative-on-disk location of a KYC file, always under `kyc/<appId>/`. */
export function kycRelativePath(
  applicationId: string,
  storageName: string,
): string {
  return path.posix.join('kyc', applicationId, storageName);
}

/** Relative-on-disk location of a deposit screenshot, under `deposits/<id>/`. */
export function depositRelativePath(
  requestId: string,
  storageName: string,
): string {
  return path.posix.join('deposits', requestId, storageName);
}

/**
 * Resolves a stored file to an absolute path and verifies, with the final
 * resolved path, that it stays inside the private storage root. Throws a
 * BadRequestException on any traversal attempt.
 */
export function resolvePrivatePath(
  storageRoot: string,
  relativePath: string,
): string {
  const root = path.resolve(storageRoot);
  const full = path.resolve(root, relativePath);

  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new BadRequestException('Invalid storage path');
  }

  return full;
}

/** Absolute path to an application's private directory. */
export function applicationDir(
  storageRoot: string,
  applicationId: string,
): string {
  return path.join(path.resolve(storageRoot), 'kyc', applicationId);
}

/** Absolute path to a deposit request's private directory. */
export function depositDir(storageRoot: string, requestId: string): string {
  return path.join(path.resolve(storageRoot), 'deposits', requestId);
}

/**
 * Safe Content-Disposition header value. The client-supplied original
 * filename is never echoed raw: quotes and non-ASCII bytes are stripped for
 * the ASCII fallback, and an RFC 5987 `filename*` carries the UTF-8 form.
 */
export function contentDisposition(
  filename: string,
  attachment: boolean,
): string {
  const ascii = filename
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
    .slice(0, 200);
  const type = attachment ? 'attachment' : 'inline';
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
