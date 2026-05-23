import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';
export const SUBSCRIPTION_BILLING_QUEUE = 'subscription-billing';
export const RECONCILE_STALE_QUEUE = 'reconcile-stale';

/**
 * Shared Bull/Redis configuration used by both payment-gateway (producer)
 * and payment-worker (consumer). Connects to the same Redis instance so the
 * two processes can exchange jobs.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
        const isTls = url.startsWith('rediss://');
        return {
          url,
          redis: {
            // Upstash + most managed Redis providers need explicit TLS config
            // even when the URL says rediss://. Empty object enables default TLS.
            ...(isTls && { tls: {} }),
            // Bull requires these — without them, ioredis kills the connection
            // after 20 retries (MaxRetriesPerRequestError) and the worker crashes
            // instead of patiently reconnecting through transient blips.
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
          },
        };
      },
    }),
    BullModule.registerQueue(
      {
        name: WEBHOOK_DELIVERY_QUEUE,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 }, // 5s, 25s, 125s, ~10m, ~50m
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      },
      {
        name: SUBSCRIPTION_BILLING_QUEUE,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 100,
          removeOnFail: 1000,
        },
      },
      {
        name: RECONCILE_STALE_QUEUE,
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: 50,
          removeOnFail: 100,
        },
      },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
