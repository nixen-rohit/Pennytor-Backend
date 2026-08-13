import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const CSRF_COOKIE = 'csrf_token';

/**
 * HMAC-signed CSRF token (stateless double-submit variant).
 *
 * The token value is random; the cookie stores `value.signature` where
 * signature = HMAC-SHA256(server secret, value). On every state-changing
 * request a CsrfGuard requires:
 *
 *   X-CSRF-Token header  ===  csrf_token cookie value
 *   AND signature verifies against the server secret.
 *
 * Why this defeats CSRF:
 * - Cross-site requests (the attack) can't READ the victim's csrf_token
 *   cookie or the in-memory token held by the app, so they cannot echo it.
 * - Even if an attacker could set a cookie of their own (e.g. via a
 *   subdomain), they cannot forge the HMAC without the server secret.
 * - SameSite=Lax already blocks cross-site cookie delivery for the session
 *   cookie; the token layer covers the gaps SameSite cannot (older browsers,
 *   same-site but cross-origin attackers).
 */
@Injectable()
export class CsrfService {
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.get<string>(
      'CSRF_SECRET',
      'dev-only-csrf-secret-change-me',
    );
  }

  issue(): { value: string; cookieValue: string } {
    const value = randomBytes(32).toString('hex');
    return { value, cookieValue: this.sign(value) };
  }

  private sign(value: string): string {
    return `${value}.${createHmac('sha256', this.secret).update(value).digest('hex')}`;
  }

  /** Verifies a cookie value (signature) and matches it against the header token. */
  verify(
    headerToken: string | undefined,
    cookieValue: string | undefined,
  ): boolean {
    if (!headerToken || !cookieValue) return false;

    const [value, signature] = cookieValue.split('.');
    if (!value || !signature) return false;

    const expected = createHmac('sha256', this.secret)
      .update(value)
      .digest('hex');
    const sigOk =
      expected.length === signature.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

    return (
      sigOk && timingSafeEqual(Buffer.from(value), Buffer.from(headerToken))
    );
  }
}
