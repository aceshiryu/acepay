import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
      // Default behavior: reads .env from process.cwd() — works on App Engine
      // (cwd=/workspace) and locally when run from the gateway's directory.
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
