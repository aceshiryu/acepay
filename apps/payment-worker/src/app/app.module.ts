import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '../../../payment-gateway/src/database/database.module';
import { QueueModule } from '../../../payment-gateway/src/common/queue/queue.module';
import { CommonServicesModule } from '../../../payment-gateway/src/common/services/common-services.module';
import {
  App, Customer, Subscription, Transaction, WebhookEvent,
} from '../../../payment-gateway/src/database/entities';
import { PaymentProvidersModule } from '../../../payment-gateway/src/payment-providers/payment-providers.module';
import { MarketplaceCoreModule } from '../../../payment-gateway/src/modules/marketplace/marketplace-core.module';
import { HealthController } from './health.controller';
import { WebhookDeliveryProcessor } from './processors/webhook-delivery.processor';
import { ReconcileStaleProcessor } from './processors/reconcile-stale.processor';
import { SubscriptionBillingProcessor } from './processors/subscription-billing.processor';
import { PayoutRunProcessor } from './processors/payout-run.processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // .env already loaded by main.ts via `import 'dotenv/config'`. This
      // module just exposes those values through ConfigService.
    }),
    DatabaseModule,
    QueueModule,
    CommonServicesModule,
    PaymentProvidersModule,
    MarketplaceCoreModule,
    TypeOrmModule.forFeature([App, Subscription, Customer, Transaction, WebhookEvent]),
  ],
  controllers: [HealthController],
  providers: [
    WebhookDeliveryProcessor,
    ReconcileStaleProcessor,
    SubscriptionBillingProcessor,
    PayoutRunProcessor,
  ],
})
export class AppModule {}
