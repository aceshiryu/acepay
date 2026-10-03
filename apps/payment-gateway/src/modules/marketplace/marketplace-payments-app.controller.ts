import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../auth/api-key.guard';
import { CurrentApp } from '../../auth/current-app.decorator';
import { AppRateLimitGuard } from '../../common/throttling/app-rate-limit.guard';
import { App } from '../../database/entities';
import { CreateMarketplacePaymentDto } from './dto/marketplace-payment.dto';
import { MarketplacePaymentsService } from './marketplace-payments.service';

/**
 * POST /v1/payments — back for marketplace apps only (Slice 6). The read /
 * refund / sync routes on the same path live in PaymentsAppController.
 */
@ApiTags('payments')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard, AppRateLimitGuard)
@Controller('v1/payments')
export class MarketplacePaymentsAppController {
  constructor(private readonly payments: MarketplacePaymentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Charge a customer on behalf of a merchant (marketplace apps only)',
    description:
      "Creates a Xendit checkout on the merchant's sub-account. When it's paid, the app's platform fee is split " +
      'off to AcePay and the rest stays with the merchant until a payout run. Returns `checkoutUrl` plus the fee ' +
      'breakdown. Re-sending the same `idempotencyKey` returns the same payment.',
  })
  create(@CurrentApp() app: App, @Body() dto: CreateMarketplacePaymentDto) {
    return this.payments.create(app, dto);
  }
}
