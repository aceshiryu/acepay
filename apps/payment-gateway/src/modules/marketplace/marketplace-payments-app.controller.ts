import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../auth/api-key.guard';
import { CurrentApp } from '../../auth/current-app.decorator';
import { AppRateLimitGuard } from '../../common/throttling/app-rate-limit.guard';
import { App } from '../../database/entities';
import { CreateMarketplacePaymentDto } from './dto/marketplace-payment.dto';
import { MarketplacePaymentsService } from './marketplace-payments.service';
import { OneTimePaymentsService } from '../payments/one-time-payments.service';

/**
 * POST /v1/payments. Marketplace apps charge FOR a merchant (Slice 6, Xendit
 * split); other apps take a plain one-time payment on their own provider
 * (PayMongo Checkout). The read / refund / sync routes on the same path live
 * in PaymentsAppController.
 */
@ApiTags('payments')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard, AppRateLimitGuard)
@Controller('v1/payments')
export class MarketplacePaymentsAppController {
  constructor(
    private readonly payments: MarketplacePaymentsService,
    private readonly oneTime: OneTimePaymentsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a one-time payment and get a checkout URL',
    description:
      '**Marketplace apps** (send `merchantId`): creates a Xendit checkout on the merchant\'s sub-account. When it\'s '
      + 'paid, the app\'s platform fee is split off to AcePay and the rest stays with the merchant until a payout run. '
      + 'Returns the fee breakdown too.\n\n'
      + '**Other apps** (no `merchantId`): a normal one-time payment on the app\'s provider — PayMongo Checkout '
      + '(card, GCash, Maya, …). Listen for `payment.succeeded` on your webhook.\n\n'
      + 'Re-sending the same `idempotencyKey` returns the same payment.',
  })
  create(@CurrentApp() app: App, @Body() dto: CreateMarketplacePaymentDto) {
    if (dto.merchantId || app.marketplaceEnabled) return this.payments.create(app, dto);
    return this.oneTime.create(app, dto);
  }
}
