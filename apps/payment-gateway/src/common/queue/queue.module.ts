import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';
export const SUBSCRIPTION_BILLING_QUEUE = 'subscription-billing';
export const RECONCILE_STALE_QUEUE = 'reconcile-stale';
export const PAYOUT_RUNS_QUEUE = 'payout-runs';

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
          // Reduce idle polling chatter to ~6× fewer Redis commands. With 3
          // queues × default 5s polling, the worker burns ~155K commands/day
          // doing nothing — enough to exhaust Upstash's 10K/day free tier in
          // hours. With these settings, idle polling drops to ~25K/day, and
          // jobs still pick up within the configured drainDelay window.
          settings: {
            // How long Bull waits between empty job-list checks. Higher = fewer
            // commands, slightly higher pickup latency. 30s is fine for webhook
            // delivery + subscription billing; tighten if you need <30s job pickup.
            drainDelay: 30,
            // How often to check for "stuck" in-flight jobs that crashed mid-
            // process. 60s is generous; default is 30s.
            stalledInterval: 60_000,
            // Lockout duration for in-flight jobs. Should be >> max job runtime.
            lockDuration: 60_000,
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
      {
        // Marketplace payout runs (Slice 6). Both job types are safe to retry:
        // build only reads balances, and execute only sends payouts still
        // `queued`, each with its own idempotency key.
        name: PAYOUT_RUNS_QUEUE,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
