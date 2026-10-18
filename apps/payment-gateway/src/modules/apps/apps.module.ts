import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { App, Plan } from '../../database/entities';
import { PlatformSetting } from '../../database/entities/platform-setting.entity';
import { PaymentProvidersModule } from '../../payment-providers/payment-providers.module';
import { CustomersAppModule } from '../customers/customers-app.module';
import { MarketplaceCoreModule } from '../marketplace/marketplace-core.module';
import { SubscriptionsAppModule } from '../subscriptions/subscriptions-app.module';
import { AppsController } from './apps.controller';
import { AppPreferencesService } from './app-preferences.service';
import { AppStatusService } from './app-status.service';
import { PaymentsAppModule } from '../payments/payments-app.module';
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
    PaymentsAppModule,
    TypeOrmModule.forFeature([App, Plan, PlatformSetting]),
  ],
  controllers: [AppsController, WebhookPingAppController],
  providers: [AppsService, WebhookPingService, AppStatusService, AppPreferencesService],
  exports: [AppsService, WebhookPingService, AppStatusService, AppPreferencesService],
})
export class AppsModule {}
