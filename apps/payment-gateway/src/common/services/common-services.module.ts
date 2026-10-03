import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { App, Transaction, TransactionLog, WebhookEvent } from '../../database/entities';
import { PaymentProvidersModule } from '../../payment-providers/payment-providers.module';
import { QueueModule } from '../queue/queue.module';
import { PayoutRunQueueService } from '../queue/payout-run-queue.service';
import { SubscriptionBillingQueueService } from '../queue/subscription-billing-queue.service';
import { WebhookDeliveryQueueService } from '../queue/webhook-delivery-queue.service';
import { MetadataValidatorService } from './metadata-validator.service';
import { PaymentReconcilerService } from './payment-reconciler.service';
import { TransactionLoggerService } from './transaction-logger.service';
import { WebhookDeliveryService } from './webhook-delivery.service';

@Module({
  imports: [
    PaymentProvidersModule,
    QueueModule,
    TypeOrmModule.forFeature([TransactionLog, WebhookEvent, Transaction, App]),
  ],
  providers: [
    TransactionLoggerService,
    MetadataValidatorService,
    WebhookDeliveryService,
    WebhookDeliveryQueueService,
    SubscriptionBillingQueueService,
    PayoutRunQueueService,
    PaymentReconcilerService,
  ],
  exports: [
    TransactionLoggerService,
    MetadataValidatorService,
    WebhookDeliveryService,
    WebhookDeliveryQueueService,
    SubscriptionBillingQueueService,
    PayoutRunQueueService,
    PaymentReconcilerService,
  ],
})
export class CommonServicesModule {}
