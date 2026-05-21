import {
  BadRequestException, Body, Controller, Get, Post, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../auth/admin.guard';
import { Provider } from '../../common/enums';
import { WebhooksService } from '../webhooks/webhooks.service';
import { SettingsAdminService } from './settings-admin.service';

interface SimulateBody {
  provider: Provider;
  /** Required for Xendit to drive the subscription first-payment handler. */
  acepaySubscriptionId?: string;
}

@ApiTags('admin/settings')
@ApiBearerAuth('admin')
@Controller('admin/settings')
@UseGuards(AdminGuard)
export class SettingsAdminController {
  constructor(
    private readonly settings: SettingsAdminService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Per-provider env + last-webhook-received health check' })
  health() {
    return this.settings.health();
  }

  @Post('simulate-webhook')
  @ApiOperation({
    summary: 'Synthesize a valid signed webhook for the given provider and run it through the actual receiver. Verifies the handler chain end-to-end without an external provider call.',
  })
  async simulate(@Body() body: SimulateBody) {
    if (body.provider === Provider.Xendit) {
      const { headers, body: payload } = this.settings.buildSyntheticXenditInvoicePaid({
        acepaySubscriptionId: body.acepaySubscriptionId,
      });
      const raw = Buffer.from(JSON.stringify(payload));
      try {
        const result = await this.webhooks.handle(Provider.Xendit, raw, headers['x-callback-token']);
        return { ok: true, simulated: 'invoice.paid', payload, result };
      } catch (err) {
        throw new BadRequestException({
          error: 'simulate_failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (body.provider === Provider.Lemonsqueezy) {
      const { headers, body: payload } = this.settings.buildSyntheticLemonOrderCreated();
      const raw = Buffer.from(JSON.stringify(payload));
      try {
        const result = await this.webhooks.handle(Provider.Lemonsqueezy, raw, headers['x-signature']);
        return { ok: true, simulated: 'order_created', payload, result };
      } catch (err) {
        throw new BadRequestException({
          error: 'simulate_failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    throw new BadRequestException({
      error: 'unsupported_provider',
      message: `Cannot simulate for provider "${body.provider}"`,
    });
  }
}
