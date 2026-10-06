import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { App, Plan } from '../../database/entities';
import { PaymentProvidersModule } from '../../payment-providers/payment-providers.module';
import { CustomersAppModule } from '../customers/customers-app.module';
import { MarketplaceCoreModule } from '../marketplace/marketplace-core.module';
import { SubscriptionsAppModule } from '../subscriptions/subscriptions-app.module';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';
import { WebhookPingAppController } from './webhook-ping-app.controller';
import { WebhookPingService } from './webhook-ping.service';

@Module({
  imports: [
    AuthModule,
    PaymentProvidersModule,
    CustomersAppModule,
    SubscriptionsAppModule,
    MarketplaceCoreModule,
    TypeOrmModule.forFeature([App, Plan]),
  ],
  controllers: [AppsController, WebhookPingAppController],
  providers: [AppsService, WebhookPingService],
  exports: [AppsService, WebhookPingService],
})
export class AppsModule {}
