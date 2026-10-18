import { createHmac, timingSafeEqual } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { signLinkToken } from '../common/crypto';
import { PlanInterval, Provider, SubscriptionStatus, TransactionStatus } from '../common/enums';
import {
  ConnectionCheck, CreatePaymentParams, CreatePaymentResult, CreateSubscriptionParams, CreateSubscriptionResult,
  FetchedPayment, FetchedSubscription, NormalizedEvent, PaymentProvider, ProviderCallOptions, RefundResult,
} from './provider.types';
import { ProviderCredentialsService } from './provider-credentials.service';

const PAYMONGO_API = 'https://api.paymongo.com/v1';

/** Link-token purpose for the AcePay-hosted PayMongo pay page. */
export const PAYMONGO_PAY_LINK = 'paymongo-pay';

/** Checkout methods offered when PAYMONGO_PAYMENT_METHODS is unset. Each must
 *  be activated on the PayMongo account, or PayMongo rejects the checkout. */
export const DEFAULT_PAYMONGO_METHODS = ['card', 'gcash', 'paymaya', 'grab_pay', 'qrph'];

/** PayMongo resource as returned by the API: `{ id, type, attributes }`. */
interface Resource<A = Record<string, unknown>> {
  id: string;
  type?: string;
  attributes: A;
}

interface SubscriptionAttrs {
  status?: string;
  customer_id?: string;
  next_billing_schedule?: string | null;
  anchor_date?: string | null;
  cancelled_at?: number | null;
  created_at?: number;
  latest_invoice?: {
    id?: string;
    amount?: number;
    currency?: string;
    status?: string;
    payment_intent?: { id?: string; status?: string } | null;
  } | null;
  plan?: { id?: string; name?: string; amount?: number; currency?: string } | null;
}

interface PaymentIntentAttrs {
  amount?: number;
  currency?: string;
  status?: string;
  client_key?: string;
  last_payment_error?: unknown;
  payments?: Array<Resource<{ amount?: number; status?: string }>>;
}

interface PlanAttrs {
  name?: string;
  amount?: number;
  currency?: string;
  interval?: string;
  interval_count?: number;
}

export interface PaymongoPlan {
  planId: string;
  name: string;
  amount: number;
  currency: string;
  interval: PlanInterval;
  intervalCount: number;
}

/** What the pay page needs to collect the first payment of a subscription. */
export interface PaymongoPayContext {
  subscriptionStatus: string;
  invoiceStatus: string | null;
  paymentIntentId: string | null;
  paymentIntentStatus: string | null;
  clientKey: string | null;
  amount: number;
  currency: string;
  planName: string | null;
  lastPaymentError: string | null;
}

/** `sk_live_…` is real money, `sk_test_…` is the sandbox. There's no separate flag. */
export function paymongoKeyMode(key: string | undefined | null): ConnectionCheck['mode'] {
  if (key?.startsWith('sk_live_')) return 'live';
  if (key?.startsWith('sk_test_')) return 'test';
  return 'unknown';
}

/** `Paymongo-Signature: t=<unix>,te=<test sig>,li=<live sig>` */
export function parsePaymongoSignature(header: string): { t?: string; te?: string; li?: string } {
  const out: Record<string, string> = {};
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** The AcePay-hosted page where a customer pays a PayMongo subscription's
 *  first invoice. PayMongo has no hosted page for it. */
export function paymongoPayLink(publicBaseUrl: string, acepaySubscriptionId: string): string {
  const base = publicBaseUrl.replace(/\/$/, '');
  return `${base}/v1/pay/paymongo/${acepaySubscriptionId}?t=${signLinkToken(PAYMONGO_PAY_LINK, acepaySubscriptionId)}`;
}

/**
 * PayMongo (Philippines): one-time payments via Checkout Sessions, recurring
 * via PayMongo's own Subscriptions API — PayMongo bills every cycle itself and
 * reports through webhooks, so the AcePay billing queue isn't involved.
 *
 * UNITS: PayMongo takes MINOR units (centavos), like Lemon Squeezy and unlike
 * Xendit. Amounts pass straight through — never divide by 100 here.
 *
 * No official maintained Node SDK covers Checkout Sessions + Subscriptions,
 * so this talks to the REST API directly (Basic auth, secret key as username).
 */
@Injectable()
export class PaymongoAdapter implements PaymentProvider {
  readonly name = Provider.Paymongo;
  private readonly logger = new Logger(PaymongoAdapter.name);

  constructor(private readonly config: ProviderCredentialsService) {}

  // ─── Config ───────────────────────────────────────────────────────────

  private secretKey(): string {
    const key = this.config.get<string>('PAYMONGO_SECRET_KEY');
    if (!key) throw new Error('PAYMONGO_SECRET_KEY env var is not set');
    return key;
  }

  /** Publishable key, embedded in the pay page so the customer's browser can
   *  send card details straight to PayMongo. */
  publicKey(): string {
    const key = this.config.get<string>('PAYMONGO_PUBLIC_KEY');
    if (!key) throw new Error('PAYMONGO_PUBLIC_KEY env var is not set');
    return key;
  }

  private webhookSecret(): string {
    const s = this.config.get<string>('PAYMONGO_WEBHOOK_SECRET');
    if (!s) throw new Error('PAYMONGO_WEBHOOK_SECRET env var is not set');
    return s;
  }

  private publicBaseUrl(): string {
    const base = this.config.get<string>('PUBLIC_BASE_URL');
    if (!base) {
      throw new Error(
        'PUBLIC_BASE_URL is not set — PayMongo subscriptions need it, because the customer pays the ' +
        'first invoice on an AcePay-hosted page at <PUBLIC_BASE_URL>/v1/pay/paymongo/…',
      );
    }
    return base;
  }

  private paymentMethodTypes(): string[] {
    const raw = this.config.get<string>('PAYMONGO_PAYMENT_METHODS');
    const list = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return list.length > 0 ? list : DEFAULT_PAYMONGO_METHODS;
  }

  private async http<A = Record<string, unknown>>(
    method: 'GET' | 'POST',
    path: string,
    attributes?: Record<string, unknown>,
  ): Promise<Resource<A>> {
    try {
      const resp = await axios.request<{ data: Resource<A> }>({
        method,
        url: `${PAYMONGO_API}${path}`,
        auth: { username: this.secretKey(), password: '' },
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        data: attributes ? { data: { attributes } } : undefined,
        timeout: 20_000,
      });
      return resp.data.data;
    } catch (err) {
      throw new Error(`PayMongo ${method} ${path} failed: ${describeError(err)}`);
    }
  }

  private async httpList<A = Record<string, unknown>>(path: string): Promise<Array<Resource<A>>> {
    try {
      const resp = await axios.get<{ data: Array<Resource<A>> }>(`${PAYMONGO_API}${path}`, {
        auth: { username: this.secretKey(), password: '' },
        headers: { Accept: 'application/json' },
        timeout: 20_000,
      });
      return resp.data.data ?? [];
    } catch (err) {
      throw new Error(`PayMongo GET ${path} failed: ${describeError(err)}`);
    }
  }

  // ─── Health ───────────────────────────────────────────────────────────

  async checkConnection(): Promise<ConnectionCheck> {
    const mode = paymongoKeyMode(this.config.get<string>('PAYMONGO_SECRET_KEY'));
    try {
      const hooks = await this.httpList<{ url?: string; status?: string }>('/webhooks');
      const enabled = hooks.filter((h) => h.attributes?.status === 'enabled');
      const counts = `${hooks.length} webhook${hooks.length === 1 ? '' : 's'} registered (${enabled.length} enabled)`;
      // The usual reason PayMongo payments never confirm in AcePay: the
      // enabled webhook still points at an old tunnel URL. Say so here.
      const base = this.config.get<string>('PUBLIC_BASE_URL');
      if (!base) return { ok: true, mode, detail: `Connected. ${counts}. Set PUBLIC_BASE_URL so AcePay can check they point here.` };
      const expected = `${base.replace(/\/$/, '')}/v1/webhooks/paymongo`;
      const pointsHere = enabled.some((h) => (h.attributes?.url ?? '').replace(/\/$/, '') === expected);
      return {
        ok: true, mode,
        detail: pointsHere
          ? `Connected. ${counts}, including one for this gateway.`
          : `Connected, but no enabled PayMongo webhook points at ${expected} — payments won't confirm in AcePay. ${counts}: ${
            hooks.map((h) => `${h.attributes?.url ?? '?'} (${h.attributes?.status ?? '?'})`).join(', ') || 'none'}.`,
      };
    } catch (err) {
      return { ok: false, mode, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  // ─── One-time payments (Checkout Sessions) ────────────────────────────

  async createPayment(p: CreatePaymentParams): Promise<CreatePaymentResult> {
    const description = p.description ?? `Payment for ${p.appSlug}`;
    const session = await this.http<{ checkout_url?: string; created_at?: number }>('POST', '/checkout_sessions', {
      line_items: [{ name: description, amount: p.amount, currency: p.currency.toUpperCase(), quantity: 1 }],
      payment_method_types: this.paymentMethodTypes(),
      success_url: p.redirect.success,
      cancel_url: p.redirect.failed,
      description,
      reference_number: p.acepayTxId,
      send_email_receipt: false,
      ...(p.customer?.email || p.customer?.name
        ? { billing: { email: p.customer.email, name: p.customer.name } }
        : {}),
      metadata: stringifyMetadata({ acepay_tx: p.acepayTxId, app_slug: p.appSlug, ...p.metadata }),
    });
    if (!session.attributes.checkout_url) throw new Error('PayMongo did not return a checkout URL');
    return {
      providerTxId: session.id,
      checkoutUrl: session.attributes.checkout_url,
      providerCreatedAt: fromUnix(session.attributes.created_at) ?? new Date(),
      raw: session as unknown as Record<string, unknown>,
    };
  }

  /**
   * The stored id is a checkout session (`cs_…`) until the session is paid,
   * then the payment intent (`pi_…`) — the webhook swaps it, the same way the
   * Lemon Squeezy checkout id becomes an order id. A bare payment (`pay_…`)
   * is accepted too.
   */
  async getPayment(providerTxId: string, _opts?: ProviderCallOptions): Promise<FetchedPayment> {
    if (providerTxId.startsWith('cs_')) {
      const s = await this.http<{ status?: string; paid_at?: number; payments?: Array<Resource<{ status?: string }>> }>(
        'GET', `/checkout_sessions/${providerTxId}`,
      );
      const paid = (s.attributes.payments ?? []).some((pay) => pay.attributes?.status === 'paid');
      return {
        providerTxId,
        status: paid ? TransactionStatus.Succeeded
          : s.attributes.status === 'expired' ? TransactionStatus.Failed
          : TransactionStatus.Pending,
        providerCompletedAt: paid ? fromUnix(s.attributes.paid_at) ?? new Date() : null,
        raw: s as unknown as Record<string, unknown>,
      };
    }
    if (providerTxId.startsWith('ref_')) {
      // A refund row (AcePay stores the refund id on it). Lets the stale-tx
      // reconciler finish a refund whose payment.refunded webhook never came.
      const ref = await this.http<{ status?: string; updated_at?: number }>('GET', `/refunds/${providerTxId}`);
      const st = ref.attributes.status;
      return {
        providerTxId,
        status: st === 'succeeded' ? TransactionStatus.Refunded : st === 'failed' ? TransactionStatus.Failed : TransactionStatus.Pending,
        providerCompletedAt: st === 'succeeded' ? fromUnix(ref.attributes.updated_at) ?? new Date() : null,
        raw: ref as unknown as Record<string, unknown>,
      };
    }
    if (providerTxId.startsWith('pay_')) {
      const pay = await this.http<{ status?: string; paid_at?: number }>('GET', `/payments/${providerTxId}`);
      const st = pay.attributes.status;
      return {
        providerTxId,
        status: st === 'paid' ? TransactionStatus.Succeeded : st === 'failed' ? TransactionStatus.Failed : TransactionStatus.Pending,
        providerCompletedAt: st === 'paid' ? fromUnix(pay.attributes.paid_at) ?? new Date() : null,
        raw: pay as unknown as Record<string, unknown>,
      };
    }
    const pi = await this.http<PaymentIntentAttrs>('GET', `/payment_intents/${providerTxId}`);
    return {
      providerTxId,
      status: mapPaymentIntentStatus(pi.attributes),
      providerCompletedAt: pi.attributes.status === 'succeeded' ? new Date() : null,
      raw: pi as unknown as Record<string, unknown>,
    };
  }

  /** PayMongo refunds a PAYMENT (`pay_…`) and needs an explicit amount; resolve
   *  both from whatever id kind is stored. Omitting `amount` = full refund. */
  async refund(providerTxId: string, amount?: number, _opts?: ProviderCallOptions): Promise<RefundResult> {
    const payment = await this.resolvePayment(providerTxId);
    const refundAmount = amount ?? payment.amount;
    if (!refundAmount) throw new Error(`PayMongo payment ${payment.id} has no amount to refund`);
    const refund = await this.http<{ status?: string }>('POST', '/refunds', {
      amount: refundAmount,
      payment_id: payment.id,
      reason: 'others',
    });
    const st = refund.attributes.status;
    return {
      providerRefundId: refund.id,
      status: st === 'succeeded' ? TransactionStatus.Refunded
        : st === 'failed' ? TransactionStatus.Failed
        : TransactionStatus.Pending,
      raw: refund as unknown as Record<string, unknown>,
    };
  }

  private async resolvePayment(providerTxId: string): Promise<{ id: string; amount: number | null }> {
    if (providerTxId.startsWith('pay_')) {
      const pay = await this.http<{ amount?: number }>('GET', `/payments/${providerTxId}`);
      return { id: pay.id, amount: pay.attributes.amount ?? null };
    }
    const payments = providerTxId.startsWith('cs_')
      ? (await this.http<{ payments?: Array<Resource<{ amount?: number; status?: string }>> }>(
        'GET', `/checkout_sessions/${providerTxId}`,
      )).attributes.payments
      : (await this.http<PaymentIntentAttrs>('GET', `/payment_intents/${providerTxId}`)).attributes.payments;
    const paid = (payments ?? []).find((pay) => pay.attributes?.status === 'paid') ?? payments?.[0];
    if (!paid) throw new Error(`PayMongo ${providerTxId} has no payment to refund yet`);
    return { id: paid.id, amount: paid.attributes?.amount ?? null };
  }

  // ─── Plans (not part of PaymentProvider; used when registering plans) ─

  async getPlan(planId: string): Promise<PaymongoPlan> {
    return toPlan(await this.http<PlanAttrs>('GET', `/subscriptions/plans/${planId}`));
  }

  async createPlan(p: {
    name: string; description?: string | null; amount: number; currency: string;
    interval: PlanInterval; intervalCount: number; metadata?: Record<string, unknown>;
  }): Promise<PaymongoPlan> {
    const plan = await this.http<PlanAttrs>('POST', '/subscriptions/plans', {
      name: p.name,
      description: p.description || p.name,
      amount: p.amount,
      currency: p.currency.toUpperCase(),
      interval: p.interval,
      interval_count: p.intervalCount,
      ...(p.metadata ? { metadata: stringifyMetadata(p.metadata) } : {}),
    });
    return toPlan(plan);
  }

  /**
   * The PayMongo plan an AcePay plan points at. With `existingPlanId` the
   * operator linked a plan made in PayMongo, and PayMongo's price/interval win
   * (like a Lemon Squeezy variant). Without it AcePay creates one from the
   * operator's values. PayMongo plans are PHP-only with a ₱1.00 minimum.
   */
  async resolvePlan(p: {
    existingPlanId?: string | null; name: string; description?: string | null;
    amount?: number | null; currency?: string | null; interval?: PlanInterval | null; intervalCount?: number | null;
  }): Promise<PaymongoPlan> {
    const existing = p.existingPlanId?.trim();
    if (existing) return planCall(() => this.getPlan(existing));
    if (!p.amount || !p.currency || !p.interval) {
      throw new BadRequestException({
        error: 'paymongo_plan_fields_required',
        message: 'PayMongo plans need amount, currency and interval (or the id of a plan you already made in PayMongo)',
      });
    }
    if (p.currency.toUpperCase() !== 'PHP') {
      throw new BadRequestException({ error: 'paymongo_currency_unsupported', message: 'PayMongo plans must be in PHP' });
    }
    if (p.amount < 100) {
      throw new BadRequestException({ error: 'paymongo_amount_too_small', message: 'PayMongo plans must be at least ₱1.00 (100 centavos)' });
    }
    const count = p.intervalCount ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      throw new BadRequestException({ error: 'paymongo_interval_count_invalid', message: 'PayMongo bills every 1 to 10 intervals' });
    }
    const amount = p.amount;
    const interval = p.interval;
    return planCall(() => this.createPlan({
      name: p.name, description: p.description, amount, currency: 'PHP',
      interval, intervalCount: count,
    }));
  }

  // ─── Subscriptions ────────────────────────────────────────────────────

  /**
   * Creates a PayMongo customer + subscription. PayMongo immediately opens the
   * first invoice with a payment intent; the customer pays it on the AcePay pay
   * page (card or Maya), which also vaults the payment method for later cycles.
   * The subscription id exists right away, so unlike Lemon Squeezy there's no
   * checkout-id → subscription-id swap. The first payment must happen within
   * 24h or PayMongo cancels it (`incomplete_cancelled`).
   */
  async createSubscription(p: CreateSubscriptionParams): Promise<CreateSubscriptionResult> {
    const payLink = paymongoPayLink(this.publicBaseUrl(), p.acepaySubscriptionId);
    const { first, last } = splitName(p.customer.name, p.customer.email);
    const customer = await this.http('POST', '/customers', {
      first_name: first,
      last_name: last,
      email: p.customer.email,
      default_device: 'email',
    });
    const sub = await this.http<SubscriptionAttrs>('POST', '/subscriptions', {
      customer_id: customer.id,
      plan_id: p.providerPlanId,
    });
    return {
      providerCheckoutId: sub.id,
      checkoutUrl: payLink,
      providerCreatedAt: fromUnix(sub.attributes.created_at) ?? new Date(),
      raw: sub as unknown as Record<string, unknown>,
      providerMetadata: {
        paymongo: {
          customerId: customer.id,
          // PayMongo has nowhere to keep these, and the pay page needs them
          // to send the customer back to the app.
          successUrl: p.redirect.success,
          failedUrl: p.redirect.failed,
        },
      },
    };
  }

  async getSubscription(providerSubscriptionId: string): Promise<FetchedSubscription> {
    return toFetchedSubscription(
      await this.http<SubscriptionAttrs>('GET', `/subscriptions/${providerSubscriptionId}`),
    );
  }

  /** Immediate: PayMongo has no cancel-at-period-end. Open invoices stay collectible. */
  async cancelSubscription(providerSubscriptionId: string): Promise<FetchedSubscription> {
    await this.http('POST', `/subscriptions/${providerSubscriptionId}/cancel`, { cancellation_reason: 'other' });
    const fetched = await this.getSubscription(providerSubscriptionId);
    return { ...fetched, status: SubscriptionStatus.Canceled, canceledAt: fetched.canceledAt ?? new Date() };
  }

  async uncancelSubscription(): Promise<FetchedSubscription> {
    throw notSupported('Reactivating a canceled subscription', 'cancellation is immediate and final — create a new subscription');
  }

  async pauseSubscription(): Promise<FetchedSubscription> {
    throw notSupported('Pausing', 'cancel it instead, or keep it active');
  }

  async resumeSubscription(): Promise<FetchedSubscription> {
    throw notSupported('Resuming', 'PayMongo subscriptions cannot be paused');
  }

  /** Everything the pay page needs, read fresh from PayMongo on every load. */
  async payPageContext(providerSubscriptionId: string): Promise<PaymongoPayContext> {
    const sub = await this.http<SubscriptionAttrs>('GET', `/subscriptions/${providerSubscriptionId}`);
    const inv = sub.attributes.latest_invoice ?? null;
    const piId = inv?.payment_intent?.id ?? null;
    const pi = piId ? await this.http<PaymentIntentAttrs>('GET', `/payment_intents/${piId}`) : null;
    return {
      subscriptionStatus: sub.attributes.status ?? 'unknown',
      invoiceStatus: inv?.status ?? null,
      paymentIntentId: piId,
      paymentIntentStatus: pi?.attributes.status ?? inv?.payment_intent?.status ?? null,
      clientKey: pi?.attributes.client_key ?? null,
      amount: pi?.attributes.amount ?? inv?.amount ?? sub.attributes.plan?.amount ?? 0,
      currency: (pi?.attributes.currency ?? inv?.currency ?? 'PHP').toUpperCase(),
      planName: sub.attributes.plan?.name ?? null,
      lastPaymentError: describePaymentError(pi?.attributes.last_payment_error),
    };
  }

  // ─── Webhooks ─────────────────────────────────────────────────────────

  /**
   * HMAC-SHA256 of `<t>.<raw body>` with the webhook's secret, compared to `li`
   * for live events and `te` for test ones. No timestamp window: PayMongo
   * retries failed deliveries, and replays are already stopped by the
   * (provider, event id) dedup in WebhooksService.
   */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): unknown {
    if (!signature) throw new Error('Missing Paymongo-Signature header');
    const parts = parsePaymongoSignature(signature);
    let payload: { data?: { attributes?: { livemode?: boolean } } };
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new Error('Webhook body is not valid JSON');
    }
    const given = payload?.data?.attributes?.livemode === true ? parts.li : parts.te;
    if (!parts.t || !given) throw new Error('Malformed Paymongo-Signature header');
    const expected = createHmac('sha256', this.webhookSecret())
      .update(`${parts.t}.${rawBody.toString('utf8')}`)
      .digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Invalid PayMongo webhook signature');
    return payload;
  }

  normalizeEvent(payload: unknown): NormalizedEvent {
    const ev = (payload as { data?: Resource<{ type?: string; created_at?: number; data?: Resource }> }).data;
    if (!ev?.attributes?.type) throw new Error('Not a PayMongo event payload');
    const type = ev.attributes.type;
    const res = ev.attributes.data ?? ({ id: '', attributes: {} } as Resource);
    const a = (res.attributes ?? {}) as Record<string, unknown>;

    let event = `paymongo.${type}`;
    let status: TransactionStatus | null = null;
    let subscriptionStatus: SubscriptionStatus | null = null;
    let providerTxId: string | null = null;
    let providerSubscriptionId: string | null = null;
    let acepayTxId: string | null = null;
    let periodStart: Date | null = null;
    let paymentChannel: string | null = null;
    let refunds: NormalizedEvent['refunds'];

    switch (type) {
      case 'checkout_session.payment.paid': {
        event = 'payment.succeeded';
        status = TransactionStatus.Succeeded;
        // Swap the stored checkout id to the payment intent — refunds and
        // payment.refunded events only know the intent.
        const pi = a.payment_intent as { id?: string } | undefined;
        providerTxId = pi?.id ?? res.id;
        const meta = (a.metadata ?? {}) as Record<string, string>;
        acepayTxId = meta.acepay_tx ?? (a.reference_number as string | undefined) ?? null;
        // Where PayMongo says how it was paid varies: `payment_method_used`
        // ("gcash"), else the payment's source, on the session or nested in
        // the intent. Card checkouts often carry neither — left unknown.
        type PaymentRes = Resource<{ status?: string; source?: { type?: string } }>;
        const intent = a.payment_intent as { attributes?: { payments?: PaymentRes[] } } | undefined;
        const payments = [...((a.payments ?? []) as PaymentRes[]), ...(intent?.attributes?.payments ?? [])];
        const paid = payments.find((p) => p.attributes?.status === 'paid') ?? payments[0];
        paymentChannel = channelFromSourceType(
          (a.payment_method_used as string | undefined) ?? paid?.attributes?.source?.type,
        );
        break;
      }
      case 'payment.refunded': {
        // The event's resource is the PAYMENT, with every refund on it. Only a
        // payment refunded in full becomes Refunded; a partial refund leaves it
        // Succeeded so the rest can still be refunded.
        event = 'refund.succeeded';
        providerTxId = (a.payment_intent_id as string | undefined) ?? res.id;
        const list = (a.refunds ?? []) as Array<Resource<{ amount?: number; status?: string }>>;
        refunds = list.map((r) => ({
          providerRefundId: r.id,
          amount: Number(r.attributes?.amount ?? 0),
          status: r.attributes?.status === 'succeeded' ? TransactionStatus.Refunded
            : r.attributes?.status === 'failed' ? TransactionStatus.Failed
            : TransactionStatus.Pending,
        }));
        const refunded = refunds
          .filter((r) => r.status === TransactionStatus.Refunded)
          .reduce((sum, r) => sum + r.amount, 0);
        const total = Number(a.amount ?? 0);
        // No list (older payload shape): keep the old behaviour, a refund event means refunded.
        status = list.length === 0 || (total > 0 && refunded >= total)
          ? TransactionStatus.Refunded
          : TransactionStatus.Succeeded;
        break;
      }

      case 'subscription.invoice.paid':
        event = 'subscription.payment_succeeded';
        status = TransactionStatus.Succeeded;
        subscriptionStatus = SubscriptionStatus.Active;
        providerSubscriptionId = invoiceSubscriptionId(a);
        providerTxId = invoicePaymentIntentId(a);
        periodStart = a.due_date ? new Date(String(a.due_date)) : fromUnix(ev.attributes.created_at);
        break;
      case 'subscription.invoice.payment_failed':
        // PayMongo retries the invoice daily up to 3 times; each failure is one
        // event. subscription.past_due / .unpaid carry the status change.
        event = 'subscription.payment_failed';
        status = TransactionStatus.Failed;
        providerSubscriptionId = invoiceSubscriptionId(a);
        providerTxId = invoicePaymentIntentId(a);
        break;

      case 'subscription.activated':
        event = 'subscription.updated';
        subscriptionStatus = SubscriptionStatus.Active;
        providerSubscriptionId = res.id;
        break;
      case 'subscription.past_due':
      case 'subscription.unpaid':
        event = 'subscription.updated';
        subscriptionStatus = SubscriptionStatus.PastDue;
        providerSubscriptionId = res.id;
        break;
      case 'subscription.updated': {
        providerSubscriptionId = res.id;
        subscriptionStatus = mapSubscriptionStatus(String(a.status ?? ''));
        event = subscriptionStatus === SubscriptionStatus.Canceled ? 'subscription.canceled'
          : subscriptionStatus === SubscriptionStatus.Expired ? 'subscription.expired'
          : 'subscription.updated';
        break;
      }

      default:
        // payment.paid / payment.failed / invoice drafts etc. duplicate events
        // handled above. Keep them recorded but unattached (no ids), so they
        // aren't forwarded to apps.
        this.logger.debug(`Unmapped PayMongo event: ${type}`);
    }

    return {
      event,
      providerEventId: ev.id,
      providerTxId,
      providerSubscriptionId,
      acepayTxId,
      acepaySubscriptionId: null,
      status,
      subscriptionStatus,
      provider: Provider.Paymongo,
      raw: payload as Record<string, unknown>,
      occurredAt: fromUnix(ev.attributes.created_at),
      periodStart,
      paymentChannel,
      ...(refunds ? { refunds } : {}),
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** PayMongo payment source types → AcePay's channel codes (Xendit's
 *  vocabulary, which `isRefundableOnline` understands). */
export function channelFromSourceType(type: string | undefined): string | null {
  switch (type) {
    case undefined:
    case '':         return null;
    case 'card':     return 'CREDIT_CARD';
    case 'gcash':    return 'GCASH';
    case 'paymaya':  return 'PAYMAYA';
    case 'grab_pay': return 'GRABPAY';
    case 'shopee_pay': return 'SHOPEEPAY';
    case 'qrph':     return 'QRPH';
    case 'billease': return 'BILLEASE';
    default:         return type.toUpperCase();
  }
}

/** PayMongo refusing a plan (e.g. Subscriptions not enabled on the account,
 *  unknown plan id) is the operator's to fix, so it's a 400 with PayMongo's
 *  own message — not a 500 that reads like an AcePay crash. */
async function planCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException({
      error: 'paymongo_plan_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function notSupported(action: string, hint: string): BadRequestException {
  return new BadRequestException({
    error: 'not_supported_by_provider',
    message: `${action} is not supported for PayMongo subscriptions — ${hint}.`,
  });
}

function invoiceSubscriptionId(a: Record<string, unknown>): string | null {
  const nested = a.subscription as { id?: string } | undefined;
  return nested?.id ?? (a.subscription_id as string | undefined) ?? null;
}

function invoicePaymentIntentId(a: Record<string, unknown>): string | null {
  const pi = a.payment_intent as { id?: string } | undefined;
  return pi?.id ?? (a.payment_intent_id as string | undefined) ?? null;
}

export function mapSubscriptionStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'active':
    case 'incomplete':           return SubscriptionStatus.Active;   // first payment pending
    case 'past_due':
    case 'unpaid':               return SubscriptionStatus.PastDue;
    case 'cancelled':            return SubscriptionStatus.Canceled;
    case 'incomplete_cancelled': return SubscriptionStatus.Expired;  // first invoice never paid
    default:                     return SubscriptionStatus.Active;
  }
}

function mapPaymentIntentStatus(a: PaymentIntentAttrs): TransactionStatus {
  if (a.status === 'succeeded') return TransactionStatus.Succeeded;
  if (a.status === 'awaiting_payment_method' && a.last_payment_error) return TransactionStatus.Failed;
  return TransactionStatus.Pending;
}

function toFetchedSubscription(s: Resource<SubscriptionAttrs>): FetchedSubscription {
  const next = s.attributes.next_billing_schedule ? new Date(s.attributes.next_billing_schedule) : null;
  return {
    providerSubscriptionId: s.id,
    status: mapSubscriptionStatus(String(s.attributes.status ?? '')),
    currentPeriodStart: s.attributes.anchor_date ? new Date(s.attributes.anchor_date) : null,
    currentPeriodEnd: next,
    cancelAt: null,
    canceledAt: fromUnix(s.attributes.cancelled_at),
    raw: s as unknown as Record<string, unknown>,
  };
}

function toPlan(p: Resource<PlanAttrs>): PaymongoPlan {
  const interval = Object.values(PlanInterval).find((i) => i === p.attributes.interval);
  if (!interval) {
    throw new Error(`PayMongo plan ${p.id} has interval "${p.attributes.interval}" — AcePay supports weekly, monthly, yearly`);
  }
  return {
    planId: p.id,
    name: p.attributes.name ?? p.id,
    amount: Number(p.attributes.amount ?? 0),
    currency: String(p.attributes.currency ?? 'PHP').toUpperCase(),
    interval,
    intervalCount: Number(p.attributes.interval_count ?? 1),
  };
}

/** PayMongo customers require both names. Fall back to the email's local part. */
export function splitName(name: string | undefined, email: string): { first: string; last: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    const local = email.split('@')[0] || 'Customer';
    return { first: local, last: local };
  }
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function fromUnix(v: number | null | undefined): Date | null {
  return typeof v === 'number' && v > 0 ? new Date(v * 1000) : null;
}

function describeError(err: unknown): string {
  const ax = err as AxiosError<{ errors?: Array<{ code?: string; detail?: string }> }>;
  const first = ax?.response?.data?.errors?.[0];
  if (first?.detail) return `${first.detail}${first.code ? ` (${first.code})` : ''}`;
  if (ax?.response?.status) return `HTTP ${ax.response.status}`;
  return err instanceof Error ? err.message : String(err);
}

function describePaymentError(e: unknown): string | null {
  if (!e) return null;
  if (typeof e === 'string') return e;
  const o = e as { failed_message?: string; detail?: string; message?: string; failed_code?: string };
  return o.failed_message ?? o.detail ?? o.message ?? o.failed_code ?? 'The payment was declined';
}

function stringifyMetadata(md: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(md)) {
    // PayMongo strips keys starting PYM_ and accepts string values only.
    if (v == null || k.startsWith('PYM_')) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}
