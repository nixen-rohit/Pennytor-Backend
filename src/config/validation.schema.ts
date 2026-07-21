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

  // bcrypt cost factor — 12 is a reasonable production default
  BCRYPT_SALT_ROUNDS: Joi.number().min(10).max(15).default(12),

  OTP_EXPIRY_MINUTES: Joi.number().default(5),
  OTP_MAX_ATTEMPTS: Joi.number().default(5),
  OTP_LENGTH: Joi.number().default(6),

  BREVO_API_KEY: Joi.string().required(),
  MAIL_FROM: Joi.string().email().required(),
  MAIL_FROM_NAME: Joi.string().default('Pennytor'),

  THROTTLE_TTL_SECONDS: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(10),

  // JWT access token — base64-encoded HS256 key, generated via openssl rand -base64 64
  JWT_ACCESS_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRY: Joi.string().default('15m'),

  // Refresh token lifetime in days (opaque random string, not a JWT)
  JWT_REFRESH_EXPIRY_DAYS: Joi.number().default(30),

  // Password reset token lifetime in minutes (opaque random string, not a JWT)
  PASSWORD_RESET_EXPIRY_MINUTES: Joi.number().default(15),
});
