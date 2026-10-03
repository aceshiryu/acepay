import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from '../auth/auth.module';
import { validateEnv } from '../common/config/validate-env';
import { ThrottlingModule } from '../common/throttling/throttling.module';
import { QueueModule } from '../common/queue/queue.module';
import { DatabaseModule } from '../database/database.module';
import { AppsModule } from '../modules/apps/apps.module';
import { StatsModule } from '../modules/stats/stats.module';
import { TransactionsAdminModule } from '../modules/transactions/transactions-admin.module';
import { SubscriptionsAdminModule } from '../modules/subscriptions/subscriptions-admin.module';
import { CustomersAdminModule } from '../modules/customers/customers-admin.module';
import { WebhookEventsAdminModule } from '../modules/webhook-events/webhook-events-admin.module';
import { ActivityLogsAdminModule } from '../modules/activity-logs/activity-logs-admin.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { SettingsAdminModule } from '../modules/settings/settings-admin.module';
import { PaymentsAppModule } from '../modules/payments/payments-app.module';
import { CustomersAppModule } from '../modules/customers/customers-app.module';
import { PlansModule } from '../modules/plans/plans.module';
import { SubscriptionsAppModule } from '../modules/subscriptions/subscriptions-app.module';
import { LemonsqueezyModule } from '../modules/lemonsqueezy/lemonsqueezy.module';
import { WebhooksModule } from '../modules/webhooks/webhooks.module';
import { HealthModule } from '../modules/health/health.module';
import { MarketplaceModule } from '../modules/marketplace/marketplace.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Default behavior: reads .env from process.cwd() — works on App Engine
      // (cwd=/workspace) and locally when run from the gateway's directory.
      // Fail fast at boot on a misconfigured environment.
      validate: validateEnv,
    }),
    // Structured JSON logging with a per-request id. Secrets are redacted so
    // API keys / auth headers never land in logs.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: (req: IncomingMessage, res: ServerResponse) => {
          const incoming = req.headers['x-request-id'];
          const id = (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers["x-api-key"]',
            'req.headers.cookie',
            'req.headers["x-callback-token"]',
          ],
          remove: true,
        },
        // Don't log the health probes on every ping.
        autoLogging: {
          ignore: (req: IncomingMessage) => (req.url ?? '').startsWith('/health'),
        },
      },
    }),
    DatabaseModule,
    QueueModule,
    ThrottlingModule,
    AuthModule,
    // admin
    AppsModule,
    StatsModule,
    TransactionsAdminModule,
    SubscriptionsAdminModule,
    CustomersAdminModule,
    WebhookEventsAdminModule,
    ActivityLogsAdminModule,
    NotificationsModule,
    SettingsAdminModule,
    LemonsqueezyModule,
    // app-facing
    PaymentsAppModule,
    CustomersAppModule,
    PlansModule,
    SubscriptionsAppModule,
    // marketplace: merchants, split payments, payout runs (+ its webhook receiver)
    MarketplaceModule,
    // provider webhook receivers
    WebhooksModule,
    // ops
    HealthModule,
  ],
})
export class AppModule {}
