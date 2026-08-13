import { BadRequestException } from '@nestjs/common';
import { KycFileType } from '@prisma/client';

/**
 * Content-level validation. The client-provided MIME type and filename are
 * NEVER trusted on their own: the first bytes of the uploaded buffer are
 * inspected for real file signatures before anything is written to disk.
 */

export type DetectedKind = 'jpeg' | 'png' | 'webp' | 'pdf';

export const MIME_BY_KIND: Record<DetectedKind, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

export const EXTENSION_BY_KIND: Record<DetectedKind, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  pdf: 'pdf',
};

/** Loose MIME allowlist used by the multer filter; the strict magic-byte
 * check in the file service is the real gate. */
export const ALLOWED_UPLOAD_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/octet-stream',
]);

/** Magic-byte signatures (first bytes of the file, not the declared MIME). */
export function detectFileKind(buffer: Buffer): DetectedKind | null {
  if (!buffer || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'pdf';
  }
  return null;
}

/** Document kinds (Aadhaar front/back, PAN) may be image or PDF. */
const DOCUMENT_KINDS: ReadonlySet<DetectedKind> = new Set([
  'jpeg',
  'png',
  'pdf',
]);

/** Selfie and signature are photos only. */
const IMAGE_KINDS: ReadonlySet<DetectedKind> = new Set(['jpeg', 'png', 'webp']);

/** Returns the detected kind if the file content matches the expected
 * formats for the requested KycFileType, otherwise null. */
export function validateFileContent(
  buffer: Buffer,
  fileType: KycFileType,
): DetectedKind | null {
  const kind = detectFileKind(buffer);
  if (!kind) return null;

  switch (fileType) {
    case KycFileType.SELFIE:
    case KycFileType.SIGNATURE:
      return IMAGE_KINDS.has(kind) ? kind : null;
    case KycFileType.AADHAAR_FRONT:
    case KycFileType.AADHAAR_BACK:
    case KycFileType.PAN:
      return DOCUMENT_KINDS.has(kind) ? kind : null;
    default:
      return null;
  }
}

export function assertUploadSize(fileSize: number, maxBytes: number): void {
  if (fileSize <= 0) {
    throw new BadRequestException('Uploaded file is empty');
  }
  if (fileSize > maxBytes) {
    throw new BadRequestException(
      `File exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit`,
    );
  }
}
