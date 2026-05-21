import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  cancelSubscription, createCheckout, getCheckout, getOrder, getProduct, getStore,
  getSubscription, getVariant, issueOrderRefund, lemonSqueezySetup, updateSubscription,
} from '@lemonsqueezy/lemonsqueezy.js';
import { PlanInterval, Provider, SubscriptionStatus, TransactionStatus } from '../common/enums';
import {
  CreatePaymentParams, CreatePaymentResult, CreateSubscriptionParams, CreateSubscriptionResult,
  FetchedPayment, FetchedSubscription, NormalizedEvent, PaymentProvider, RefundResult,
} from './provider.types';

export interface LookedUpVariant {
  variantId: string;
  productId: string;
  productName: string;
  name: string;
  slug: string;
  price: number;
  currency: string;
  isSubscription: boolean;
  interval: PlanInterval | null;
  intervalCount: number;
  testMode: boolean;
}

interface LemonEvent {
  meta: {
    event_name: string;
    custom_data?: Record<string, string>;
  };
  data: {
    type: string;
    id: string;
    attributes: Record<string, unknown> & {
      status?: string;
      created_at?: string;
      refunded_at?: string;
      subscription_id?: string | number;
      renews_at?: string;
      ends_at?: string | null;
      cancelled?: boolean;
    };
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class LemonsqueezyAdapter implements PaymentProvider {
  readonly name = Provider.Lemonsqueezy;
  private readonly logger = new Logger(LemonsqueezyAdapter.name);
  private _initialized = false;
  private _storeId: string | null = null;
  private _variantId: string | null = null;
  private _webhookSecret: string | null = null;
  // Per-store currency cache — stores rarely change currency, so reuse across lookups.
  private _storeCurrency = new Map<string, string>();

  constructor(private readonly config: ConfigService) {}

  private init(): void {
    if (this._initialized) return;
    const key = this.config.get<string>('LEMONSQUEEZY_API_KEY');
    if (!key) throw new Error('LEMONSQUEEZY_API_KEY env var is not set');
    lemonSqueezySetup({ apiKey: key });
    this._initialized = true;
  }

  private storeId(): string {
    if (this._storeId) return this._storeId;
    const id = this.config.get<string>('LEMONSQUEEZY_STORE_ID');
    if (!id) throw new Error('LEMONSQUEEZY_STORE_ID env var is not set');
    this._storeId = id;
    return id;
  }

  private variantId(): string {
    if (this._variantId) return this._variantId;
    const id = this.config.get<string>('LEMONSQUEEZY_VARIANT_ID');
    if (!id) {
      throw new Error(
        'LEMONSQUEEZY_VARIANT_ID env var is not set — register a single ' +
        '"AcePay Generic Charge" variant in your Lemon Squeezy store and set this to its ID',
      );
    }
    this._variantId = id;
    return id;
  }

  private isTestMode(): boolean {
    return this.config.get<string>('LEMONSQUEEZY_TEST_MODE') !== 'false';
  }

  private webhookSecret(): string {
    if (this._webhookSecret) return this._webhookSecret;
    const s = this.config.get<string>('LEMONSQUEEZY_WEBHOOK_SECRET');
    if (!s) throw new Error('LEMONSQUEEZY_WEBHOOK_SECRET env var is not set');
    this._webhookSecret = s;
    return s;
  }

  async createPayment(p: CreatePaymentParams): Promise<CreatePaymentResult> {
    this.init();
    const { data, error } = await createCheckout(this.storeId(), this.variantId(), {
      customPrice: p.amount,
      productOptions: {
        name: p.description ?? `Payment for ${p.appSlug}`,
        description: p.description ?? undefined,
        redirectUrl: p.redirect.success,
        receiptButtonText: 'Return to app',
        receiptLinkUrl: p.redirect.success,
      },
      checkoutOptions: { embed: false, media: false, logo: true },
      checkoutData: {
        email: p.customer?.email,
        name: p.customer?.name,
        custom: stringifyMetadata({ acepay_tx: p.acepayTxId, app_slug: p.appSlug, ...p.metadata }),
      },
      expiresAt: null,
      preview: false,
      testMode: this.isTestMode(),
    });
    if (error || !data) {
      throw new Error(`Lemon Squeezy createCheckout failed: ${error?.message ?? 'unknown'}`);
    }
    const checkout = data.data;
    const attrs = checkout.attributes as Record<string, unknown> & { url?: string; created_at?: string };
    if (!attrs.url) throw new Error('Lemon Squeezy did not return a checkout URL');
    return {
      providerTxId: String(checkout.id),
      checkoutUrl: String(attrs.url),
      providerCreatedAt: attrs.created_at ? new Date(String(attrs.created_at)) : new Date(),
      raw: checkout as unknown as Record<string, unknown>,
    };
  }

  async getPayment(providerTxId: string): Promise<FetchedPayment> {
    this.init();
    // Order ids are numeric (e.g. "12345"); checkout ids are UUIDs. Once an
    // order_created webhook arrives, the webhook handler swaps providerTxId
    // from the checkout id to the order id, so subsequent calls hit the order.
    if (!UUID_RE.test(providerTxId)) {
      const { data, error } = await getOrder(providerTxId);
      if (!error && data) return mapOrder(data.data);
    }
    const { data, error } = await getCheckout(providerTxId);
    if (error || !data) {
      throw new Error(`Lemon Squeezy: cannot fetch ${providerTxId}: ${error?.message ?? 'not found'}`);
    }
    return {
      providerTxId,
      status: TransactionStatus.Pending,
      providerCompletedAt: null,
      raw: data.data as unknown as Record<string, unknown>,
    };
  }

  async refund(providerTxId: string, amount?: number): Promise<RefundResult> {
    this.init();
    if (UUID_RE.test(providerTxId)) {
      throw new Error(
        `Cannot refund Lemon Squeezy checkout ${providerTxId} — no order has been created for it yet`,
      );
    }
    if (amount == null) {
      throw new Error('Lemon Squeezy refunds require an amount (full refunds must pass the original order total)');
    }
    const { data, error } = await issueOrderRefund(providerTxId, amount);
    if (error || !data) {
      throw new Error(`Lemon Squeezy refund failed: ${error?.message ?? 'unknown'}`);
    }
    return {
      providerRefundId: String(data.data.id),
      status: TransactionStatus.Refunded,
      raw: data.data as unknown as Record<string, unknown>,
    };
  }

  // ─── Subscriptions ────────────────────────────────────────────────────

  async createSubscription(p: CreateSubscriptionParams): Promise<CreateSubscriptionResult> {
    this.init();
    // For LS subscriptions, p.providerPlanId is the Variant ID of a Subscription-priced
    // variant in the store. Recurring price comes from the variant — no customPrice override.
    const { data, error } = await createCheckout(this.storeId(), p.providerPlanId, {
      productOptions: {
        redirectUrl: p.redirect.success,
        receiptButtonText: 'Return to app',
        receiptLinkUrl: p.redirect.success,
      },
      checkoutOptions: { embed: false, media: false, logo: true },
      checkoutData: {
        email: p.customer.email,
        name: p.customer.name,
        custom: stringifyMetadata({
          acepay_subscription: p.acepaySubscriptionId,
          app_slug: p.appSlug,
          ...p.metadata,
        }),
      },
      expiresAt: null,
      preview: false,
      testMode: this.isTestMode(),
    });
    if (error || !data) {
      throw new Error(`Lemon Squeezy createCheckout (subscription) failed: ${error?.message ?? 'unknown'}`);
    }
    const checkout = data.data;
    const attrs = checkout.attributes as Record<string, unknown> & { url?: string; created_at?: string };
    if (!attrs.url) throw new Error('Lemon Squeezy did not return a checkout URL');
    return {
      providerCheckoutId: String(checkout.id),
      checkoutUrl: String(attrs.url),
      providerCreatedAt: attrs.created_at ? new Date(String(attrs.created_at)) : new Date(),
      raw: checkout as unknown as Record<string, unknown>,
    };
  }

  async getSubscription(providerSubscriptionId: string): Promise<FetchedSubscription> {
    this.init();
    const { data, error } = await getSubscription(providerSubscriptionId);
    if (error || !data) {
      throw new Error(`Lemon Squeezy getSubscription failed: ${error?.message ?? 'unknown'}`);
    }
    return mapSubscription(data.data);
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<FetchedSubscription> {
    this.init();
    const { data, error } = await cancelSubscription(providerSubscriptionId);
    if (error || !data) {
      throw new Error(`Lemon Squeezy cancelSubscription failed: ${error?.message ?? 'unknown'}`);
    }
    return mapSubscription(data.data);
  }

  async pauseSubscription(providerSubscriptionId: string): Promise<FetchedSubscription> {
    this.init();
    const { data, error } = await updateSubscription(providerSubscriptionId, {
      pause: { mode: 'void' },
    });
    if (error || !data) {
      throw new Error(`Lemon Squeezy pauseSubscription failed: ${error?.message ?? 'unknown'}`);
    }
    return mapSubscription(data.data);
  }

  async resumeSubscription(providerSubscriptionId: string): Promise<FetchedSubscription> {
    this.init();
    const { data, error } = await updateSubscription(providerSubscriptionId, {
      pause: null,
    });
    if (error || !data) {
      throw new Error(`Lemon Squeezy resumeSubscription failed: ${error?.message ?? 'unknown'}`);
    }
    return mapSubscription(data.data);
  }

  // ─── Variant lookup (operator UX) ────────────────────────────────────

  /** Fetch a variant from LS + its parent product + store. Used by the admin
   *  UI to verify operator-pasted variant IDs and auto-fill plan details.
   *  Currency comes from the STORE (LS's authoritative source), not from the
   *  product's price_formatted (which can show $ as a generic symbol even
   *  for non-USD stores). */
  async lookupVariant(variantId: string): Promise<LookedUpVariant> {
    this.init();
    const { data: vResp, error: vErr } = await getVariant(variantId);
    if (vErr || !vResp) {
      throw new Error(`Lemon Squeezy: variant ${variantId} not found: ${vErr?.message ?? 'unknown'}`);
    }
    const variant = vResp.data;
    const va = variant.attributes as Record<string, unknown> & {
      product_id?: number | string;
      name?: string;
      slug?: string;
      price?: number;
      is_subscription?: boolean;
      interval?: string;
      interval_count?: number;
      test_mode?: boolean;
    };

    let productName = '';
    let storeId = '';
    const productId = String(va.product_id ?? '');
    if (productId) {
      const { data: pResp } = await getProduct(productId);
      const pa = pResp?.data?.attributes as Record<string, unknown> & { name?: string; store_id?: number | string } | undefined;
      productName = String(pa?.name ?? '');
      // store_id may live in attributes OR in relationships.store.data.id
      storeId = String(
        pa?.store_id
          ?? (pResp?.data?.relationships?.store?.data as { id?: string | number } | undefined)?.id
          ?? '',
      );
    }

    const currency = storeId ? await this.resolveStoreCurrency(storeId) : '';

    return {
      variantId: String(variant.id),
      productId,
      productName,
      name: String(va.name ?? ''),
      slug: String(va.slug ?? ''),
      price: Number(va.price ?? 0),
      currency,
      isSubscription: Boolean(va.is_subscription),
      interval: mapLsInterval(String(va.interval ?? '')),
      intervalCount: Number(va.interval_count ?? 1),
      testMode: Boolean(va.test_mode),
    };
  }

  private async resolveStoreCurrency(storeId: string): Promise<string> {
    const cached = this._storeCurrency.get(storeId);
    if (cached) return cached;
    try {
      const { data: sResp } = await getStore(storeId);
      const sa = sResp?.data?.attributes as Record<string, unknown> & { currency?: string } | undefined;
      const currency = String(sa?.currency ?? '').toUpperCase();
      if (currency) this._storeCurrency.set(storeId, currency);
      return currency;
    } catch (err) {
      this.logger.warn(`Could not fetch LS store ${storeId} for currency: ${err instanceof Error ? err.message : String(err)}`);
      return '';
    }
  }

  // ─── Webhooks ─────────────────────────────────────────────────────────

  verifyWebhook(rawBody: Buffer, signature: string | undefined): LemonEvent {
    if (!signature) throw new Error('Missing X-Signature header');
    const expected = createHmac('sha256', this.webhookSecret()).update(rawBody).digest('hex');
    const sig = signature.toLowerCase();
    const exp = expected.toLowerCase();
    if (sig.length !== exp.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) {
      throw new Error('Invalid Lemon Squeezy webhook signature');
    }
    return JSON.parse(rawBody.toString('utf8')) as LemonEvent;
  }

  normalizeEvent(payload: unknown): NormalizedEvent {
    const ev = payload as LemonEvent;
    const eventName = ev.meta.event_name;
    const custom = ev.meta.custom_data ?? {};
    const data = ev.data;
    const attrs = data.attributes;

    let event = 'unknown';
    let txStatus: TransactionStatus | null = null;
    let subStatus: SubscriptionStatus | null = null;

    switch (eventName) {
      case 'order_created': {
        const ord = String(attrs.status ?? 'pending');
        if (ord === 'paid')          { event = 'payment.succeeded'; txStatus = TransactionStatus.Succeeded; }
        else if (ord === 'failed')   { event = 'payment.failed';    txStatus = TransactionStatus.Failed; }
        else if (ord === 'refunded') { event = 'refund.succeeded';  txStatus = TransactionStatus.Refunded; }
        else                         { event = 'payment.pending';   txStatus = TransactionStatus.Pending; }
        break;
      }
      case 'order_refunded':
        event = 'refund.succeeded'; txStatus = TransactionStatus.Refunded; break;

      case 'subscription_created':
        event = 'subscription.created';
        subStatus = mapSubStatus(String(attrs.status ?? 'active'));
        break;
      case 'subscription_updated':
        event = 'subscription.updated';
        subStatus = mapSubStatus(String(attrs.status ?? 'active'));
        break;
      case 'subscription_cancelled':
        event = 'subscription.canceled'; subStatus = SubscriptionStatus.Canceled; break;
      case 'subscription_resumed':
        event = 'subscription.resumed'; subStatus = SubscriptionStatus.Active; break;
      case 'subscription_paused':
        event = 'subscription.paused'; subStatus = SubscriptionStatus.Paused; break;
      case 'subscription_expired':
        event = 'subscription.expired'; subStatus = SubscriptionStatus.Expired; break;

      case 'subscription_payment_success':
        event = 'subscription.payment_succeeded'; txStatus = TransactionStatus.Succeeded; break;
      case 'subscription_payment_failed':
        event = 'subscription.payment_failed'; txStatus = TransactionStatus.Failed; subStatus = SubscriptionStatus.PastDue; break;
      case 'subscription_payment_recovered':
        event = 'subscription.payment_succeeded'; txStatus = TransactionStatus.Succeeded; subStatus = SubscriptionStatus.Active; break;
      case 'subscription_payment_refunded':
        event = 'refund.succeeded'; txStatus = TransactionStatus.Refunded; break;

      default:
        this.logger.debug(`Unmapped Lemon Squeezy event: ${eventName}`);
    }

    // Resolve provider ids based on the payload type.
    let providerTxId: string | null = null;
    let providerSubscriptionId: string | null = null;
    if (data.type === 'orders') {
      providerTxId = String(data.id);
    } else if (data.type === 'subscriptions') {
      providerSubscriptionId = String(data.id);
    } else if (data.type === 'subscription-invoices') {
      // payment_success / payment_failed events arrive as subscription-invoices;
      // the underlying subscription id is in attributes.subscription_id.
      providerSubscriptionId = attrs.subscription_id != null ? String(attrs.subscription_id) : null;
    }

    const occurredAt = attrs.created_at ? new Date(String(attrs.created_at)) : null;

    return {
      event,
      providerEventId: `${eventName}_${data.id}`,
      providerTxId,
      providerSubscriptionId,
      acepayTxId: custom.acepay_tx ?? null,
      acepaySubscriptionId: custom.acepay_subscription ?? null,
      status: txStatus,
      subscriptionStatus: subStatus,
      provider: Provider.Lemonsqueezy,
      raw: ev as unknown as Record<string, unknown>,
      occurredAt,
    };
  }
}

function stringifyMetadata(md: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(md)) {
    if (v == null) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

function mapOrder(data: { id: string; attributes: Record<string, unknown> }): FetchedPayment {
  const attrs = data.attributes as Record<string, unknown> & { status?: string; created_at?: string; refunded_at?: string };
  const s = String(attrs.status ?? 'pending');
  let mapped: TransactionStatus;
  let completed: Date | null = null;
  switch (s) {
    case 'paid':
      mapped = TransactionStatus.Succeeded;
      completed = attrs.created_at ? new Date(String(attrs.created_at)) : null;
      break;
    case 'refunded':
      mapped = TransactionStatus.Refunded;
      completed = attrs.refunded_at ? new Date(String(attrs.refunded_at)) : null;
      break;
    case 'failed':
      mapped = TransactionStatus.Failed; break;
    default:
      mapped = TransactionStatus.Pending;
  }
  return {
    providerTxId: String(data.id),
    status: mapped,
    providerCompletedAt: completed,
    raw: data as unknown as Record<string, unknown>,
  };
}

function mapSubscription(data: { id: string; attributes: Record<string, unknown> }): FetchedSubscription {
  const a = data.attributes as Record<string, unknown> & {
    status?: string;
    renews_at?: string;
    created_at?: string;
    ends_at?: string | null;
    cancelled?: boolean;
  };
  return {
    providerSubscriptionId: String(data.id),
    status: mapSubStatus(String(a.status ?? 'active')),
    currentPeriodStart: a.created_at ? new Date(String(a.created_at)) : null,
    currentPeriodEnd: a.renews_at ? new Date(String(a.renews_at)) : null,
    cancelAt: a.ends_at ? new Date(String(a.ends_at)) : null,
    canceledAt: a.cancelled && a.ends_at ? new Date(String(a.ends_at)) : null,
    raw: data as unknown as Record<string, unknown>,
  };
}

function mapLsInterval(ls: string): PlanInterval | null {
  switch (ls) {
    case 'week':  return PlanInterval.Weekly;
    case 'month': return PlanInterval.Monthly;
    case 'year':  return PlanInterval.Yearly;
    default:      return null;
  }
}

function mapSubStatus(lemonStatus: string): SubscriptionStatus {
  switch (lemonStatus) {
    case 'on_trial':
    case 'active':    return SubscriptionStatus.Active;
    case 'paused':    return SubscriptionStatus.Paused;
    case 'past_due':
    case 'unpaid':    return SubscriptionStatus.PastDue;
    case 'cancelled': return SubscriptionStatus.Canceled;
    case 'expired':   return SubscriptionStatus.Expired;
    default:          return SubscriptionStatus.Active;
  }
}
