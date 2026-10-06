import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../auth/api-key.guard';
import { CurrentApp } from '../../auth/current-app.decorator';
import { AppRateLimitGuard } from '../../common/throttling/app-rate-limit.guard';
import { App } from '../../database/entities';
import { WebhookPingService } from './webhook-ping.service';

/** Lets an app check its own webhook end to end with its API key. */
@ApiTags('app config')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard, AppRateLimitGuard)
@Controller('v1/app/webhook-test')
export class WebhookPingAppController {
  constructor(private readonly ping: WebhookPingService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send a signed app.ping to your webhook URL now',
    description:
      'AcePay signs an `app.ping` exactly like a real webhook and POSTs it to your webhook URL. Answer it with 2xx ' +
      'after verifying the signature. The response says what your endpoint answered: `ok: true` proves both the URL ' +
      'and the webhook secret.',
  })
  test(@CurrentApp() app: App) {
    return this.ping.ping(app);
  }
}
