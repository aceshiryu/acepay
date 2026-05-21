import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonServicesModule } from '../../common/services/common-services.module';
import { App, Customer, Subscription, Transaction, WebhookEvent } from '../../database/entities';
import { PaymentProvidersModule } from '../../payment-providers/payment-providers.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [
    CommonServicesModule,
    PaymentProvidersModule,
    TypeOrmModule.forFeature([WebhookEvent, Transaction, Subscription, Customer, App]),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
