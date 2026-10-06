import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AppConfigAppController } from './app-config-app.controller';
import { MarketplaceAdminController } from './marketplace-admin.controller';
import { MarketplaceCoreModule } from './marketplace-core.module';
import { MarketplacePaymentsAppController } from './marketplace-payments-app.controller';
import { MarketplaceWebhooksController } from './marketplace-webhooks.controller';
import { MerchantsAppController } from './merchants-app.controller';

/** Slice 6 — marketplace payments + manual payout runs (gateway routes). */
@Module({
  imports: [AuthModule, MarketplaceCoreModule],
  controllers: [
    AppConfigAppController,
    MerchantsAppController,
    MarketplacePaymentsAppController,
    MarketplaceAdminController,
    MarketplaceWebhooksController,
  ],
})
export class MarketplaceModule {}
