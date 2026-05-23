/**
 * AcePay payment-worker
 *
 * Background processor that drains Bull queues populated by the gateway:
 *  - webhook-delivery     → POSTs signed events to app webhook URLs (with retries)
 *  - subscription-billing → (Slice 4b) charges saved PaymentMethods on schedule
 *  - reconcile-stale      → (Slice 4a) periodic sweep of pending transactions
 *
 * Runs as its own process so a slow customer webhook never blocks the gateway.
 */
// MUST be the first import — `dotenv/config` runs config() as a side effect at
// import time, so by the time later imports (AppModule → DatabaseModule →
// TypeOrm) read process.env, the .env values are already populated. ES imports
// are hoisted, so calling loadEnv() inline below other imports runs too late.
import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error', 'debug'] });

  // The HTTP listener exists only so App Engine / load-balancer health probes
  // get a 200 response. Routes (GET / and GET /health) live in HealthController.
  // Real work happens inside Bull processors.
  const port = Number(process.env.PORT ?? 4002);
  await app.listen(port);
  Logger.log(`🛠  AcePay payment-worker started — Bull consumer, health on :${port}/health`);
}

bootstrap();
