import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { PaymongoPayService, PayResponse } from './paymongo-pay.service';

/**
 * Public, customer-facing pages (no API key): the link itself is the
 * credential — `?t=` is an HMAC of the subscription id. Not part of the app
 * API, so it's hidden from Swagger.
 */
@ApiExcludeController()
@Controller('v1/pay/paymongo')
export class PaymongoPayController {
  constructor(private readonly pay: PaymongoPayService) {}

  @Get(':id')
  async page(@Param('id') id: string, @Query('t') t: string | undefined, @Query('e') e: string | undefined, @Res() res: Response) {
    send(res, await this.pay.page(id, t, e === '1'));
  }

  @Get(':id/return')
  async returned(@Param('id') id: string, @Query('t') t: string | undefined, @Res() res: Response) {
    send(res, await this.pay.returned(id, t));
  }
}

function send(res: Response, r: PayResponse): void {
  res.setHeader('Cache-Control', 'no-store');
  if (r.kind === 'redirect') {
    res.redirect(303, r.url);
    return;
  }
  // helmet's CSP is off globally (it would break Swagger), so this page sets a
  // strict one of its own: its nonce'd inline script, calls to
  // api.paymongo.com, and nothing else.
  res.setHeader('Content-Security-Policy', r.csp);
  res.status(r.status).type('html').send(r.html);
}
