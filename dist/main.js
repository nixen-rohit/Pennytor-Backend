"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const helmet_1 = require("helmet");
const cookieParser = require("cookie-parser");
const swagger_1 = require("@nestjs/swagger");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    const config = app.get(config_1.ConfigService);
    const logger = new common_1.Logger('Bootstrap');
    app.use((0, helmet_1.default)({
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        contentSecurityPolicy: false,
    }));
    app.use(cookieParser());
    app.enableCors({
        origin: config.get('FRONTEND_URL', 'http://localhost:3000'),
        credentials: true,
    });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        forbidUnknownValues: true,
    }));
    if (config.get('NODE_ENV') !== 'production') {
        const swaggerConfig = new swagger_1.DocumentBuilder()
            .setTitle('Pennytor API')
            .setDescription('Pennytor — Financial Investment Platform API\n\n' +
            '## Overview\n' +
            'This API powers the Pennytor financial investment platform. All endpoints are prefixed with `/api`.\n\n' +
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
            '```\n')
            .setVersion('1.0')
            .addTag('auth', 'Authentication & registration endpoints')
            .addBearerAuth({
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Enter your JWT access token',
        }, 'access-token')
            .build();
        const document = swagger_1.SwaggerModule.createDocument(app, swaggerConfig);
        swagger_1.SwaggerModule.setup('docs', app, document, {
            swaggerOptions: {
                persistAuthorization: true,
            },
        });
    }
    const port = config.get('PORT', 3001);
    await app.listen(port);
    logger.log(`Pennytor backend running on port ${port}`);
    logger.log(`http://localhost:${port}`);
}
bootstrap();
//# sourceMappingURL=main.js.map