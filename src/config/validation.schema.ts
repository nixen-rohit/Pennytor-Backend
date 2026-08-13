import * as Joi from 'joi';

/**
 * Validated once at boot. If anything required is missing or malformed,
 * the app refuses to start rather than failing later at request time.
 */
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3001),

  DATABASE_URL: Joi.string().uri().required(),

  FRONTEND_URL: Joi.string().uri().required(),

  // Server-side session lifetime in days. The HttpOnly `sid` cookie maxAge
  // is derived from this, so cookie and session expiry are always in sync.
  SESSION_TTL_DAYS: Joi.number().min(1).max(365).default(30),

  // HMAC key that signs the CSRF tokens. Generate: openssl rand -hex 32
  CSRF_SECRET: Joi.string().min(32).required(),

  OTP_EXPIRY_MINUTES: Joi.number().default(5),
  OTP_MAX_ATTEMPTS: Joi.number().default(5),
  OTP_LENGTH: Joi.number().default(6),

  BREVO_API_KEY: Joi.string().required(),
  MAIL_FROM: Joi.string().email().required(),
  MAIL_FROM_NAME: Joi.string().default('Pennytor'),

  THROTTLE_TTL_SECONDS: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(10),

  PASSWORD_RESET_EXPIRY_MINUTES: Joi.number().default(15),

  // Root of the private document store. Files under here are NEVER served
  // by Nginx — only through the authenticated /api/admin/kyc endpoints.
  PRIVATE_STORAGE_PATH: Joi.string().min(1).default('/var/private-storage'),

  // AES-256 key for the admin-reviewable KYC ciphertext columns.
  // Generate: openssl rand -hex 32
  DATA_ENCRYPTION_KEY: Joi.string()
    .length(64)
    .pattern(/^[0-9a-f]{64}$/i)
    .required(),

  // Hard cap for a single uploaded KYC document, in MB.
  KYC_UPLOAD_MAX_MB: Joi.number().min(1).max(10).default(2),
});
