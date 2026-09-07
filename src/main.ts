import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
      // Tighten clickjacking + referrer leakage beyond Helmet's defaults.
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      ...(config.get<string>('NODE_ENV') === 'production'
        ? { hsts: { maxAge: 31536000, includeSubDomains: true, preload: true } }
        : {}),
    }),
  );
  app.use(cookieParser());
  // Normalized (trailing slash removed): the browser's Origin header never
  // carries one, and CORS + CSRF origin checks compare exact strings.
  const frontendUrl = (
    config.get<string>('FRONTEND_URL', 'http://localhost:3000') ?? ''
  ).replace(/\/+$/, '');
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties not in the DTO
      forbidNonWhitelisted: true, // reject requests that include unknown properties
      transform: true, // apply @Transform decorators (e.g. email lowercasing)
      forbidUnknownValues: true,
    }),
  );

  if (config.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Pennytor API')
      .setDescription(
        'Pennytor — Financial Investment Platform API\n\n' +
          '## Overview\n' +
          'This API powers the Pennytor financial investment platform. All endpoints are prefixed with `/api`.\n\n' +
          '## Authentication\n' +
          'Server-side sessions. `POST /auth/login` sets an HttpOnly `sid` cookie ' +
          '(same-site deployment required). State-changing requests need the ' +
          '`X-CSRF-Token` header matching the signed `csrf_token` cookie issued at login /auth/me.\n\n' +
          '## Rate Limiting\n' +
          'All endpoints are rate-limited. Specific limits are documented per endpoint.\n' +
          'Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) are included in responses.\n\n' +
          '## Error Responses\n' +
          'All errors follow a standard shape:\n' +
          '```json\n' +
          '{\n' +
          '  "statusCode": 400,\n' +
          '  "path": "/api/auth/register",\n' +
          '  "timestamp": "2025-01-01T00:00:00.000Z",\n' +
          '  "message": "Validation failed"\n' +
          '}\n' +
          '```\n',
      )
      .setVersion('1.0')
      .addTag('auth', 'Authentication & registration endpoints')
      .addCookieAuth(
        'sid',
        {
          type: 'apiKey',
          in: 'cookie',
          name: 'sid',
          description:
            'Session cookie, set automatically by POST /auth/login. ' +
            'Copy it from the Login response in a browser devtools session, ' +
            'or use the "Try it out" flow: login → copy Set-Cookie → add here. ' +
            'Authenticated mutations also require a valid `X-CSRF-Token` header ' +
            '(value of the `csrf_token` cookie, issued at login and /auth/me).',
        },
        'session-cookie',
      )
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  const port = config.get<number>('PORT', 3001);

  await app.listen(port);
  logger.log(`Pennytor backend running on port ${port}`);
  logger.log(`http://localhost:${port}`);
}

bootstrap();
