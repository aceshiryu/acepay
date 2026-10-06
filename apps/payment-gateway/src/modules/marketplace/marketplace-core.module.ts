import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonServicesModule } from '../../common/services/common-services.module';
import {
  App, AppConfigChange, Merchant, Payout, PayoutRun, PlatformSetting, Transaction, WebhookEvent,
  XenditSplitRule,
} from '../../database/entities';
import { PaymentProvidersModule } from '../../payment-providers/payment-providers.module';
import { AppConfigService } from './app-config.service';
import { MarketplaceAdminService } from './marketplace-admin.service';
import { MarketplaceConfigCheck } from './marketplace-config-check';
import { MarketplaceDefaultsService } from './marketplace-defaults.service';
import { MarketplacePaymentsService } from './marketplace-payments.service';
import { MarketplaceWebhooksService } from './marketplace-webhooks.service';
import { MerchantEventsService } from './merchant-events.service';
import { MerchantsService } from './merchants.service';
import { PayoutRunsService } from './payout-runs.service';
import { SplitRulesService } from './split-rules.service';

/**
 * Marketplace services with no HTTP routes, so the worker can import them
 * (it runs payout-run build/execute jobs) without mounting controllers.
 */
@Module({
  imports: [
    CommonServicesModule,
    PaymentProvidersModule,
    TypeOrmModule.forFeature([
      App, AppConfigChange, Merchant, Payout, PayoutRun, PlatformSetting, Transaction, WebhookEvent, XenditSplitRule,
    ]),
  ],
  providers: [
    AppConfigService,
    MarketplaceDefaultsService,
    MerchantEventsService,
    MerchantsService,
    SplitRulesService,
    MarketplacePaymentsService,
    PayoutRunsService,
    MarketplaceWebhooksService,
    MarketplaceAdminService,
    MarketplaceConfigCheck,
  ],
  exports: [
    AppConfigService,
    MarketplaceDefaultsService,
    MerchantEventsService,
    MerchantsService,
    SplitRulesService,
    MarketplacePaymentsService,
    PayoutRunsService,
    MarketplaceWebhooksService,
    MarketplaceAdminService,
    MarketplaceConfigCheck,
  ],
})
export class MarketplaceCoreModule {}
