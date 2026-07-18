import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.use(helmet());
  app.enableCors({
    origin: config.get<string>('FRONTEND_URL'),
    credentials: true,
  });

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
      .setDescription('Pennytor backend API documentation')
      .setVersion('1.0')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.get<number>('PORT', 3001);
  await app.listen(port);
  logger.log(`Pennytor backend running on port ${port}`);
}

bootstrap();
