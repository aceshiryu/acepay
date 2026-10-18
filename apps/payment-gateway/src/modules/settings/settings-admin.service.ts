import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { Provider } from '../../common/enums';
import { WebhookEvent } from '../../database/entities';
import { ProviderCredentialsService } from '../../payment-providers/provider-credentials.service';
import { INTEGRATIONS } from '../integrations/integration-catalog';

export interface ProviderHealth {
  provider: Provider;
  envOk: boolean;
  missingEnv: string[];
  webhookPath: string;
  /** Last received webhook for this provider (any event), null if never. */
  lastWebhookAt: string | null;
  /** Count of webhooks received in the last 24h. */
  count24h: number;
  /** UI verdict. */
  status: 'ok' | 'no_recent' | 'never_received' | 'misconfigured';
}

export interface SettingsHealth {
  providers: ProviderHealth[];
  /** Echoed back so the UI can build the full URL the operator must paste. */
  publicBaseHint: string | null;
}

@Injectable()
export class SettingsAdminService {
  constructor(
    @InjectRepository(WebhookEvent) private readonly webhooks: Repository<WebhookEvent>,
    private readonly config: ProviderCredentialsService,
  ) {}

  async health(): Promise<SettingsHealth> {
    const providers: ProviderHealth[] = [];
    for (const spec of INTEGRATIONS) {
      const provider = spec.provider;
      const envs = spec.credentials.filter((c) => c.required).map((c) => c.env);
      const webhookPath = spec.webhooks[0].path;
      const missing = envs.filter((k) => !this.config.get<string>(k));
      const last = await this.webhooks.createQueryBuilder('w')
        .where('w.provider = :p', { p: provider })
        .orderBy('w.createdAt', 'DESC')
        .limit(1)
        .getOne();
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const count24h = await this.webhooks.createQueryBuilder('w')
        .where('w.provider = :p', { p: provider })
        .andWhere('w.createdAt >= :since', { since })
        .getCount();
      let status: ProviderHealth['status'];
      if (missing.length > 0) status = 'misconfigured';
      else if (!last) status = 'never_received';
      else if (count24h === 0) status = 'no_recent';
      else status = 'ok';
      providers.push({
        provider,
        envOk: missing.length === 0,
        missingEnv: missing,
        webhookPath,
        lastWebhookAt: last?.createdAt?.toISOString() ?? null,
        count24h,
        status,
      });
    }
    return {
      providers,
      publicBaseHint: this.config.get<string>('PUBLIC_BASE_URL') ?? null,
    };
  }

  /** Generate a synthetic Xendit `invoice.paid` payload with a valid x-callback-token.
   *  Returns the payload + headers so the UI can POST it (or the caller can self-POST).
   *  Useful for proving the receiver + handler chain works without an external trigger. */
  buildSyntheticXenditInvoicePaid(opts: { acepaySubscriptionId?: string }): {
    headers: Record<string, string>;
    body: Record<string, unknown>;
  } {
    const token = this.config.get<string>('XENDIT_WEBHOOK_TOKEN') ?? '';
    const id = `sim_${randomUUID()}`;
    const body = {
      id,
      external_id: `acepay_sim_${id}`,
      status: 'PAID',
      amount: 100,
      currency: 'PHP',
      paid_at: new Date().toISOString(),
      payment_method_id: `pm_sim_${randomUUID().slice(0, 8)}`,
      metadata: opts.acepaySubscriptionId
        ? { acepay_subscription: opts.acepaySubscriptionId }
        : {},
    };
    return { headers: { 'x-callback-token': token }, body };
  }

  /** Generate a synthetic Lemon Squeezy `order_created` payload with a valid x-signature. */
  buildSyntheticLemonOrderCreated(): {
    headers: Record<string, string>;
    body: Record<string, unknown>;
  } {
    const secret = this.config.get<string>('LEMONSQUEEZY_WEBHOOK_SECRET') ?? '';
    const body = {
      // A real LS payload carries a genuine AcePay uuid here, so emit one.
      meta: { event_name: 'order_created', custom_data: { acepay_tx: randomUUID() } },
      data: {
        id: `sim_${randomUUID()}`,
        type: 'orders',
        attributes: { status: 'paid', total: 100, currency: 'USD' },
      },
    };
    const raw = JSON.stringify(body);
    const sig = createHmac('sha256', secret).update(raw).digest('hex');
    return { headers: { 'x-signature': sig }, body };
  }

  /** Generate a synthetic PayMongo `checkout_session.payment.paid` event, signed
   *  like a real test-mode delivery (`t=<ts>,te=<hmac of "t.body">,li=`). */
  buildSyntheticPaymongoCheckoutPaid(): {
    headers: Record<string, string>;
    body: Record<string, unknown>;
  } {
    const secret = this.config.get<string>('PAYMONGO_WEBHOOK_SECRET') ?? '';
    const now = Math.floor(Date.now() / 1000);
    const body = {
      data: {
        id: `evt_sim_${randomUUID().replace(/-/g, '')}`,
        type: 'event',
        attributes: {
          type: 'checkout_session.payment.paid',
          livemode: false,
          created_at: now,
          data: {
            id: `cs_sim_${randomUUID().replace(/-/g, '')}`,
            type: 'checkout_session',
            // A real session carries a genuine AcePay uuid here, so emit one.
            attributes: { metadata: { acepay_tx: randomUUID() }, payment_intent: { id: `pi_sim_${now}` } },
          },
        },
      },
    };
    const raw = JSON.stringify(body);
    const sig = createHmac('sha256', secret).update(`${now}.${raw}`).digest('hex');
    return { headers: { 'paymongo-signature': `t=${now},te=${sig},li=` }, body };
  }
}
