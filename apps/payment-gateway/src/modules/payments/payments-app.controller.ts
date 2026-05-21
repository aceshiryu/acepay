import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../auth/api-key.guard';
import { CurrentApp } from '../../auth/current-app.decorator';
import { App } from '../../database/entities';
import { ListPaymentsAppDto, RefundPaymentDto } from './dto/list-payments-app.dto';
import { PaymentsAppService } from './payments-app.service';

/**
 * Read / refund / sync for transactions. Creating new one-time payments
 * (POST /v1/payments) was removed in the 2026-05-17 simplification — AcePay
 * is subscription-only for now. Subscription billing creates Transactions
 * automatically via webhooks; this controller lets apps inspect + refund + sync those.
 */
@ApiTags('payments')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('v1/payments')
export class PaymentsAppController {
  constructor(private readonly payments: PaymentsAppService) {}

  @Get()
  @ApiOperation({ summary: 'List payments for the calling app, paginated' })
  list(@CurrentApp() app: App, @Query() q: ListPaymentsAppDto) {
    return this.payments.list(app, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a payment by id (must belong to the calling app)' })
  one(@CurrentApp() app: App, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.findOne(app, id);
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Refund a succeeded payment via the original provider' })
  refund(
    @CurrentApp() app: App,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
  ) {
    return this.payments.refund(app, id, dto);
  }

  @Post(':id/sync')
  @ApiOperation({
    summary: 'Force-reconcile a transaction against the provider',
    description:
      'Pulls the current state from Lemon Squeezy / Xendit, applies any status change, ' +
      'and re-delivers a normalized webhook to the app — useful when an upstream ' +
      'webhook was lost and the local status is stuck on `pending`.',
  })
  sync(@CurrentApp() app: App, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.sync(app, id);
  }
}
