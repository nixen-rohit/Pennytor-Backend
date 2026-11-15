import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Production sits behind Nginx (one proxy hop). Without this, Express sees
  // every request as 127.0.0.1: rate limiting would be shared by all users,
  // audit-log IPs wrong, and `req.secure` false despite TLS termination.
  if (config.get<string>('NODE_ENV') === 'production') {
    app.set('trust proxy', 1);
  }

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

  const port = config.get<number>('PORT', 3001);

  await app.listen(port);
  logger.log(`Pennytor backend running on port ${port}`);
  logger.log(`http://localhost:${port}`);
}

bootstrap();
