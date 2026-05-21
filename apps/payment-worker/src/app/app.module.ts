import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolve } from 'path';
import { DatabaseModule } from '../../../payment-gateway/src/database/database.module';
import { QueueModule } from '../../../payment-gateway/src/common/queue/queue.module';
import { CommonServicesModule } from '../../../payment-gateway/src/common/services/common-services.module';
import {
  Customer, Subscription, Transaction, WebhookEvent,
} from '../../../payment-gateway/src/database/entities';
import { PaymentProvidersModule } from '../../../payment-gateway/src/payment-providers/payment-providers.module';
import { WebhookDeliveryProcessor } from './processors/webhook-delivery.processor';
import { ReconcileStaleProcessor } from './processors/reconcile-stale.processor';
import { SubscriptionBillingProcessor } from './processors/subscription-billing.processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(__dirname, '../../../payment-gateway/.env'),
    }),
    DatabaseModule,
    QueueModule,
    CommonServicesModule,
    PaymentProvidersModule,
    TypeOrmModule.forFeature([Subscription, Customer, Transaction, WebhookEvent]),
  ],
  providers: [
    WebhookDeliveryProcessor,
    ReconcileStaleProcessor,
    SubscriptionBillingProcessor,
  ],
})
export class AppModule {}
