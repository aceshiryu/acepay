// MUST be the first import — `dotenv/config` runs config() as a side effect at
// import time, so by the time later imports (AppModule → DatabaseModule →
// TypeOrm) read process.env, the .env values are already populated. ES imports
// are hoisted, so calling loadEnv() inline below other imports runs too late.
import 'dotenv/config';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { initSentry } from './common/observability/sentry';

async function bootstrap() {
  // Error tracking — must init before the app is created. No-op without SENTRY_DSN.
  initSentry();

  // bufferLogs so early logs wait for the pino logger to be wired below.
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(PinoLogger));

  // Security headers (HSTS, no-sniff, frame options, etc.). CSP is disabled so
  // it doesn't break the Swagger UI at /docs; the API serves JSON, not HTML.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // One consistent error envelope for every route: { error: { code, message, requestId } }.
  app.useGlobalFilters(new AllExceptionsFilter());

  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:4000,http://localhost:3000')
    .split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({
    // Allowed if:
    //   * no Origin header (server-to-server, curl, etc.)
    //   * Origin is in the explicit CORS_ORIGINS allowlist
    //   * Origin is any *.as.r.appspot.com subdomain (covers prod admin URL
    //     plus version-prefixed URLs like dev-<sha>-dot-admin-dot-<proj>...)
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, true);
      try {
        const host = new URL(origin).hostname;
        if (host.endsWith('.as.r.appspot.com') || host.endsWith('.appspot.com')) {
          return cb(null, true);
        }
      } catch { /* malformed Origin — fall through to deny */ }
      cb(new Error(`CORS blocked: ${origin}`), false);
    },
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    // PUT is used by the marketplace admin (app settings + defaults) — leaving
    // it out fails the browser preflight for those saves only.
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AcePay Gateway')
    .setDescription('Central payment gateway — app-facing v1 API + admin API')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'apiKey')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'admin')
    .addTag('admin/auth', 'Admin login & session')
    .addTag('admin/apps', 'Register and manage apps')
    .addTag('admin/stats', 'Aggregated metrics for the dashboard')
    .addTag('admin/transactions', 'Operations on transactions')
    .addTag('admin/subscriptions', 'Operations on subscriptions')
    .addTag('admin/customers', 'Operations on customers')
    .addTag('admin/webhook-events', 'Operations on webhook events')
    .addTag('admin/logs', 'Activity log feed')
    .addTag('admin/notifications', 'Synthesized operator notifications')
    .addTag('payments', 'Create and manage payments (app-facing)')
    .addTag('subscriptions', 'Create and manage subscriptions (app-facing)')
    .addTag('customers', 'Customer registry (app-facing)')
    .addTag('webhooks', 'Provider webhook receivers')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT || 4001;
  await app.listen(port);
  Logger.log(`🚀 AcePay gateway listening on http://localhost:${port}`);
  Logger.log(`📘 Swagger UI at http://localhost:${port}/docs`);
}

bootstrap();
