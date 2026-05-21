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
      // Order matters: ConfigModule reads the first existing file.
      // App Engine deploys dist contents into /workspace, so .env sits next
      // to main.js. Locally (webpack output), .env is one dir above dist.
      envFilePath: [
        resolve(__dirname, '.env'),
        resolve(__dirname, '../.env'),
      ],
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
