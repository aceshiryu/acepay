import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../auth/api-key.guard';
import { CurrentApp } from '../../auth/current-app.decorator';
import { App } from '../../database/entities';
import { CancelSubscriptionDto, CreateSubscriptionDto } from './dto/create-subscription.dto';
import { ListSubscriptionsAppDto } from './dto/list-subscriptions-app.dto';
import { SubscriptionsAppService } from './subscriptions-app.service';

@ApiTags('subscriptions')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('v1/subscriptions')
export class SubscriptionsAppController {
  constructor(private readonly subscriptions: SubscriptionsAppService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a subscription. Returns a checkoutUrl for the customer.',
    description:
      'Generates an AcePay subscription id, creates a checkout session with the provider, ' +
      'and returns the checkout URL. The subscription starts in `active` state with ' +
      '`metadata.awaitingFirstPayment = true`; the flag clears (and the period dates fill in) ' +
      'once the provider confirms the first payment via webhook.',
  })
  create(@CurrentApp() app: App, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptions.create(app, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List subscriptions for the calling app' })
  list(@CurrentApp() app: App, @Query() q: ListSubscriptionsAppDto) {
    return this.subscriptions.list(app, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one subscription (must belong to the calling app)' })
  one(@CurrentApp() app: App, @Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.findOne(app, id);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel a subscription',
    description:
      'Cancels at the end of the current billing period (provider-default). The customer ' +
      'keeps access until then. To stop access immediately, expire the access in your app ' +
      'and call cancel here in parallel.',
  })
  cancel(
    @CurrentApp() app: App,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.subscriptions.cancel(app, id, dto);
  }

  @Post(':id/pause')
  @ApiOperation({ summary: 'Pause a subscription (no billing until resumed)' })
  pause(@CurrentApp() app: App, @Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.pause(app, id);
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Resume a paused subscription (billing restarts)' })
  resume(@CurrentApp() app: App, @Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.resume(app, id);
  }
}
