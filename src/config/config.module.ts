import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validationSchema } from './validation.schema';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validationSchema,
      validationOptions: {
        abortEarly: false, // report every missing/invalid var at once, not just the first
      },
    }),
  ],
})
export class ConfigModule {}
