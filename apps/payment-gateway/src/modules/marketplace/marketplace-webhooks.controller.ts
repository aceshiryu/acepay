import {
  BadRequestException, Controller, Headers, HttpCode, HttpStatus, Post, Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { MarketplaceWebhooksService } from './marketplace-webhooks.service';

interface RawRequest extends Request { rawBody?: Buffer }

@ApiTags('webhooks')
@Controller('v1/webhooks/xendit')
export class MarketplaceWebhooksController {
  constructor(private readonly webhooks: MarketplaceWebhooksService) {}

  @Post('marketplace')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Xendit marketplace callbacks: payouts, sub-account status, split results',
    description: 'Set this URL in the Xendit dashboard for Payouts, xenPlatform account and Split Payment webhooks. ' +
      'Verified with the same x-callback-token as /v1/webhooks/xendit.',
  })
  async receive(@Req() req: RawRequest, @Headers('x-callback-token') token: string | undefined) {
    if (!req.rawBody) throw new BadRequestException({ error: 'no_raw_body', message: 'rawBody is required' });
    return this.webhooks.handle(req.rawBody, token);
  }
}
