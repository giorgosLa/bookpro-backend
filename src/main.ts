import './instrument';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import fastifyHelmet from '@fastify/helmet';
import fastifyCompress from '@fastify/compress';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, bodyLimit: 20 * 1024 * 1024 }), // 20 MB for base64 image uploads
  );

  const config = app.get(ConfigService);
  const port = config.get<number>('port') ?? 4000;
  const appUrl = config.get<string>('appUrl') ?? 'http://localhost:3000';
  const nodeEnv = config.get<string>('nodeEnv') ?? 'development';

  await app.register(fastifyHelmet as any, { contentSecurityPolicy: false });
  await app.register(fastifyCompress as any);

  const allowedOrigins = [
    appUrl,
    'http://localhost:3000',
    'https://bookpro.gr',
    'https://www.bookpro.gr',
  ].filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.setGlobalPrefix('api/v1');

  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('BookPro API')
      .setDescription('REST API for BookPro booking platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
    logger.log(`Swagger docs → http://localhost:${port}/docs`);
  }

  const fastify = app.getHttpAdapter().getInstance() as any;

  fastify.addHook('onRequest', (request: any, _reply: any, done: () => void) => {
    request.startTime = Date.now();
    logger.log(`→ ${request.method} ${request.url}`);
    done();
  });

  fastify.addHook('onResponse', (request: any, reply: any, done: () => void) => {
    const ms = Date.now() - (request.startTime ?? Date.now());
    const status = reply.statusCode;
    const level = status >= 400 ? 'error' : 'log';
    logger[level](`← ${request.method} ${request.url} ${status} (${ms}ms)`);
    done();
  });

  await app.listen(port, '0.0.0.0');
  logger.log(`API running → http://localhost:${port}/api/v1`);
}

bootstrap();
