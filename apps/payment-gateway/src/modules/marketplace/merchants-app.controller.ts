import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../auth/api-key.guard';
import { CurrentApp } from '../../auth/current-app.decorator';
import { AppRateLimitGuard } from '../../common/throttling/app-rate-limit.guard';
import { App } from '../../database/entities';
import { CreateMerchantDto, ListMerchantsAppDto, UpdateMerchantAppDto } from './dto/merchant.dto';
import { ListPayoutsDto } from './dto/payout-run.dto';
import { MerchantsService } from './merchants.service';

/** Marketplace merchants (e.g. BooklyPH coaches). Scoped to the calling app. */
@ApiTags('merchants')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard, AppRateLimitGuard)
@Controller('v1/merchants')
export class MerchantsAppController {
  constructor(private readonly merchants: MerchantsService) {}

  @Post()
  @ApiOperation({
    summary: 'Onboard a merchant',
    description: 'Creates the merchant and its Xendit sub-account. `status` is `active` once Xendit reports the sub-account LIVE ' +
      '(usually immediately; otherwise a `merchant.activated` webhook follows). Payout details can be added now or later.',
  })
  create(@CurrentApp() app: App, @Body() dto: CreateMerchantDto) {
    return this.merchants.create(app, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List merchants (filter by externalRef to look one up by your own id)' })
  list(@CurrentApp() app: App, @Query() q: ListMerchantsAppDto) {
    return this.merchants.list(app, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a merchant' })
  one(@CurrentApp() app: App, @Param('id', ParseUUIDPipe) id: string) {
    return this.merchants.findOne(app, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update name, email, metadata or payout details (channel + account + holder together)' })
  update(@CurrentApp() app: App, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMerchantAppDto) {
    return this.merchants.update(app, id, dto);
  }

  @Get(':id/balance')
  @ApiOperation({ summary: "Live sub-account balance and what the next payout run would send" })
  balance(@CurrentApp() app: App, @Param('id', ParseUUIDPipe) id: string) {
    return this.merchants.balance(app, id);
  }

  @Get(':id/payouts')
  @ApiOperation({ summary: "Merchant's payout history" })
  payouts(@CurrentApp() app: App, @Param('id', ParseUUIDPipe) id: string, @Query() q: ListPayoutsDto) {
    return this.merchants.listPayouts(app, id, q);
  }
}
