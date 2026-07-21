import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

/**
 * Validates access tokens issued by this service.
 *
 * Algorithm is pinned to HS256 explicitly — never trust the `alg` field in
 * the token header (that would allow `alg: none` bypass attacks).
 *
 * Token payload contains only { sub, role } per design. No staleable data
 * (email, name, etc.) is ever included.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET')!,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: { sub: string; role: string }) {
    if (!payload.sub || !payload.role) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return { id: payload.sub, role: payload.role };
  }
}
