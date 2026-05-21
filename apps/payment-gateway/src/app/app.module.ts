import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'path';
import { AuthModule } from '../auth/auth.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // After webpack bundles, __dirname is apps/payment-gateway/dist/,
      // so .env at apps/payment-gateway/.env is one directory up.
      envFilePath: resolve(__dirname, '../.env'),
    }),
    DatabaseModule,
    QueueModule,
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
    // provider webhook receivers
    WebhooksModule,
  ],
})
export class AppModule {}
