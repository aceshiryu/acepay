import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonServicesModule } from '../../common/services/common-services.module';
import {
  App, Merchant, Payout, PayoutRun, Transaction, WebhookEvent, XenditSplitRule,
} from '../../database/entities';
import { PaymentProvidersModule } from '../../payment-providers/payment-providers.module';
import { MarketplaceAdminService } from './marketplace-admin.service';
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
    TypeOrmModule.forFeature([App, Merchant, Payout, PayoutRun, Transaction, WebhookEvent, XenditSplitRule]),
  ],
  providers: [
    MerchantEventsService,
    MerchantsService,
    SplitRulesService,
    MarketplacePaymentsService,
    PayoutRunsService,
    MarketplaceWebhooksService,
    MarketplaceAdminService,
  ],
  exports: [
    MerchantEventsService,
    MerchantsService,
    SplitRulesService,
    MarketplacePaymentsService,
    PayoutRunsService,
    MarketplaceWebhooksService,
    MarketplaceAdminService,
  ],
})
export class MarketplaceCoreModule {}
