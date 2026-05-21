import {
  BadRequestException, Controller, Headers, HttpCode, HttpStatus, Post, Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Provider } from '../../common/enums';
import { WebhooksService } from './webhooks.service';

interface RawRequest extends Request { rawBody?: Buffer }

@ApiTags('webhooks')
@Controller('v1/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('lemonsqueezy')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lemon Squeezy webhook receiver. Verifies x-signature, normalizes, delivers.' })
  async lemonsqueezy(
    @Req() req: RawRequest,
    @Headers('x-signature') sig: string | undefined,
  ) {
    const raw = req.rawBody;
    if (!raw) throw new BadRequestException({ error: 'no_raw_body', message: 'rawBody is required' });
    return this.webhooks.handle(Provider.Lemonsqueezy, raw, sig);
  }

  @Post('xendit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xendit webhook receiver. Verifies x-callback-token, normalizes, delivers.' })
  async xendit(
    @Req() req: RawRequest,
    @Headers('x-callback-token') token: string | undefined,
  ) {
    const raw = req.rawBody;
    if (!raw) throw new BadRequestException({ error: 'no_raw_body', message: 'rawBody is required' });
    return this.webhooks.handle(Provider.Xendit, raw, token);
  }
}
