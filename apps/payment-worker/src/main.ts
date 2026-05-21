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
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
loadEnv({ path: resolve(__dirname, '../../payment-gateway/.env') });

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error', 'debug'] });

  // Minimal HTTP listener — required so Cloud Run / Render / Fly health checks
  // see an open port. Actual work happens inside Bull processors, not HTTP.
  app.getHttpAdapter().get('/health', (_req: unknown, res: { status: (n: number) => { send: (b: string) => void } }) => {
    res.status(200).send('ok');
  });
  const port = Number(process.env.PORT ?? 4002);
  await app.listen(port);
  Logger.log(`🛠  AcePay payment-worker started — Bull consumer, health on :${port}/health`);
}

bootstrap();
