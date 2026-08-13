import { BadRequestException } from '@nestjs/common';
import { memoryStorage, Options } from 'multer';
import { ALLOWED_UPLOAD_MIMES } from '../common/utils/file-validation.util';

/**
 * Multer configuration for KYC document uploads.
 *
 * - memoryStorage: buffers the file in RAM so its real content (magic bytes)
 *   can be validated BEFORE anything touches the disk. Limits are tiny
 *   (2 MB), so memory pressure is negligible.
 * - fileFilter: coarse MIME allowlist only. The authoritative check is
 *   validateFileContent() in the file service, which inspects actual bytes.
 * - limits.files: 1 — one file per request by design.
 */
export function kycMulterOptions(maxFileBytes: number): Options {
  return {
    storage: memoryStorage(),
    limits: {
      fileSize: maxFileBytes,
      files: 1,
      fields: 8,
    },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_UPLOAD_MIMES.has(file.mimetype)) {
        // Multer's callback is overloaded (Error) | (null, boolean); TS
        // resolves a 2-arg call to the null overload, so cast explicitly.
        // Any thrown value aborts parsing and propagates to the error layer,
        // keeping the response shape consistent.
        (cb as unknown as (error: Error) => void)(
          new BadRequestException(
            `Unsupported file type: ${file.mimetype}. Supported: JPG, PNG, WebP, PDF`,
          ),
        );
        return;
      }
      cb(null, true);
    },
  };
}
