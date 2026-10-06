import { createHash, timingSafeEqual } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Xendit } from 'xendit-node';
import { Provider, TransactionStatus } from '../common/enums';
import {
  CreatePaymentParams, CreatePaymentResult, CreateSubscriptionParams, CreateSubscriptionResult,
  FetchedPayment, FetchedSubscription, NormalizedEvent, PaymentProvider, ProviderCallOptions, RefundResult,
} from './provider.types';

export interface XenditChargeResult {
  paymentRequestId: string;
  status: 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'REQUIRES_ACTION';
  failureCode?: string | null;
  actions?: Array<{ url?: string }>;
  raw: Record<string, unknown>;
}

interface XenditInvoiceWebhook {
  id: string;
  external_id?: string;
  status?: string;            // 'PAID' | 'EXPIRED' | 'PENDING'
  paid_amount?: number;
  amount?: number;
  currency?: string;
  payment_id?: string;
  payment_method_id?: string;
  payment_method?: string;
  payment_channel?: string;
  paid_at?: string;
  created?: string;
  metadata?: Record<string, string>;
}

interface XenditPaymentMethodWebhook {
  id: string;
  type?: string;
  status?: string;            // 'ACTIVE' | 'REQUIRES_ACTION' | 'FAILED' | 'EXPIRED'
  reusability?: string;
  reference_id?: string;
  customer_id?: string;
  failure_code?: string | null;
  created?: string;
  updated?: string;
  metadata?: Record<string, string>;
}

@Injectable()
export class XenditAdapter implements PaymentProvider {
  readonly name = Provider.Xendit;
  private readonly logger = new Logger(XenditAdapter.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _client: any | null = null;
  private _webhookToken: string | null = null;

  constructor(private readonly config: ConfigService) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client(): any {
    if (this._client) return this._client;
    const key = this.config.get<string>('XENDIT_SECRET_KEY');
    if (!key) throw new Error('XENDIT_SECRET_KEY env var is not set');
    this._client = new Xendit({ secretKey: key });
    return this._client;
  }

  private webhookToken(): string {
    if (this._webhookToken) return this._webhookToken;
    const t = this.config.get<string>('XENDIT_WEBHOOK_TOKEN');
    if (!t) throw new Error('XENDIT_WEBHOOK_TOKEN env var is not set');
    this._webhookToken = t;
    return t;
  }

  async createPayment(p: CreatePaymentParams): Promise<CreatePaymentResult> {
    // Use Xendit's Invoice API for a hosted checkout that accepts all enabled
    // payment methods (cards, GCash, Maya, GrabPay, bank transfer, OTC, etc.).
    // Xendit expects amounts in MAJOR units (e.g. 299, not 29900).
    const invoice = await this.client().Invoice.createInvoice({
      data: {
        externalId: p.acepayTxId,
        amount: p.amount / 100,
        currency: p.currency.toUpperCase(),
        description: p.description ?? `Payment for ${p.appSlug}`,
        payerEmail: p.customer?.email,
        successRedirectUrl: p.redirect.success,
        failureRedirectUrl: p.redirect.failed,
        metadata: stringifyMetadata({
          acepay_tx: p.acepayTxId,
          app_slug: p.appSlug,
          ...p.metadata,
        }),
      },
    });
    if (!invoice?.invoiceUrl) {
      throw new Error('Xendit did not return an invoice URL');
    }
    return {
      providerTxId: String(invoice.id),
      checkoutUrl: String(invoice.invoiceUrl),
      providerCreatedAt: invoice.created ? new Date(invoice.created) : new Date(),
      raw: invoice as unknown as Record<string, unknown>,
    };
  }

  async getPayment(providerTxId: string, opts: ProviderCallOptions = {}): Promise<FetchedPayment> {
    // Marketplace invoices live on the merchant's sub-account and are only
    // visible with its for-user-id.
    const invoice = await this.client().Invoice.getInvoiceById({
      invoiceId: providerTxId,
      ...(opts.forUserId ? { forUserId: opts.forUserId } : {}),
    });
    return mapInvoiceToFetched(invoice);
  }

  async refund(providerTxId: string, amount?: number, opts: ProviderCallOptions = {}): Promise<RefundResult> {
    // Refund straight against the invoice. The previous implementation fetched
    // the invoice first to resolve a `payment_id` — a field Xendit's Invoice
    // resource does not expose, even on a fully PAID invoice, so every refund
    // failed with a misleading "likely unpaid". CreateRefund accepts invoiceId
    // directly, so no Payments-API identifier is needed at all.
    const refund = await this.client().Refund.createRefund({
      ...(opts.forUserId ? { forUserId: opts.forUserId } : {}),
      data: {
        invoiceId: providerTxId,
        // Xendit expects MAJOR units, as everywhere else in this adapter.
        amount: amount != null ? amount / 100 : undefined,
        reason: 'REQUESTED_BY_CUSTOMER',
      },
    });
    return {
      providerRefundId: String(refund?.id ?? ''),
      status: TransactionStatus.Pending,
      raw: refund as unknown as Record<string, unknown>,
    };
  }

  // ─── Subscriptions — AcePay-managed, billing scheduled by Bull worker ─

  /**
   * Phase 4b: First-cycle payment via Invoice with save_payment_methods=true.
   * Xendit returns a hosted checkout. After the customer pays the first cycle,
   * Xendit fires invoice.paid with the saved payment_method_id, which the
   * webhook handler attaches to the AcePay Customer. Subsequent renewals are
   * charged off that saved PM by the SubscriptionBillingProcessor in the worker.
   */
  /**
   * First cycle via an Invoice (hosted checkout: card, GCash, Maya, GrabPay,
   * bank transfer, OTC).
   *
   * NOTE — recurring is NOT armed by this flow. A paid invoice yields a one-off
   * credit_card_charge_id, not a reusable payment method, so cycle 2 has nothing
   * to charge; the webhook handler flags the subscription recurringUnavailable.
   * Creating a reusable CARD payment method instead is not an option server
   * side: POST /v2/payment_methods rejects a CARD without card_information
   * ("card.card_information is required"), which would put AcePay in PCI scope.
   * E-wallet methods DO link without raw credentials — that is the viable path
   * for recurring, and it is tracked as Slice 4c.
   */
  async createSubscription(p: CreateSubscriptionParams): Promise<CreateSubscriptionResult> {
    this.client();
    const xenditCustomerId = await this.getOrCreateXenditCustomer({
      acepayCustomerRef: `acepay_${p.appSlug}_${p.acepaySubscriptionId}`,
      email: p.customer.email,
      name: p.customer.name,
    });

    const planAmountMinor = Number((p.metadata as Record<string, unknown>)?.plan_amount ?? 0);
    if (!planAmountMinor) {
      throw new Error('Xendit createSubscription requires metadata.plan_amount (smallest unit)');
    }
    const planCurrency = String((p.metadata as Record<string, unknown>)?.plan_currency ?? 'PHP');

    const invoice = await this.client().Invoice.createInvoice({
      data: {
        externalId: `sub_${p.acepaySubscriptionId}_cycle_1`,
        amount: planAmountMinor / 100,
        currency: planCurrency.toUpperCase(),
        description: `${p.appSlug} subscription — first payment`,
        payerEmail: p.customer.email,
        customerId: xenditCustomerId,
        shouldSavePaymentMethods: true,
        successRedirectUrl: p.redirect.success,
        failureRedirectUrl: p.redirect.failed,
        metadata: stringifyMetadata({
          acepay_subscription: p.acepaySubscriptionId,
          app_slug: p.appSlug,
          xendit_customer_id: xenditCustomerId,
          ...p.metadata,
        }),
      },
    });
    if (!invoice?.invoiceUrl) {
      throw new Error('Xendit did not return an invoice URL for subscription first-payment');
    }
    return {
      providerCheckoutId: String(invoice.id),
      checkoutUrl: String(invoice.invoiceUrl),
      providerCreatedAt: invoice.created ? new Date(invoice.created) : new Date(),
      raw: invoice as unknown as Record<string, unknown>,
    };
  }

  async getSubscription(providerSubscriptionId: string): Promise<FetchedSubscription> {
    // Xendit has no native subscription resource — the AcePay subscriptions
    // table is the source of truth. This method is best-effort: it returns
    // a stub indicating "the schedule is managed by AcePay's worker".
    return {
      providerSubscriptionId,
      status: 'active' as unknown as FetchedSubscription['status'],
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAt: null,
      canceledAt: null,
      raw: { note: 'xendit_subscription_managed_by_acepay' },
    };
  }

  /**
   * For Xendit, cancel = stop scheduling new billing cycles. The caller
   * (subscriptions-app.service) is responsible for removing the queued job
   * via SubscriptionBillingQueueService.cancel(); this method just returns a
   * canceled status so the AcePay sub record gets updated consistently.
   */
  async cancelSubscription(providerSubscriptionId: string): Promise<FetchedSubscription> {
    return {
      providerSubscriptionId,
      status: 'canceled' as unknown as FetchedSubscription['status'],
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAt: new Date(),
      canceledAt: new Date(),
      raw: { canceledBy: 'acepay' },
    };
  }

  /** Xendit has no provider-side subscription resource — AcePay owns the
   *  schedule and the Bull job was never removed at cancel time, so reactivate
   *  is a no-op on the provider side. SubscriptionsAppService.reactivate
   *  flips status back to Active and the queued cycle fires normally. */
  async uncancelSubscription(providerSubscriptionId: string): Promise<FetchedSubscription> {
    return {
      providerSubscriptionId,
      status: 'active' as unknown as FetchedSubscription['status'],
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAt: null,
      canceledAt: null,
      raw: { reactivatedBy: 'acepay' },
    };
  }

  /**
   * Pause is AcePay-managed: there's no Xendit subscription resource to pause.
   * The service flips the AcePay sub to `paused`; the billing worker skips (and
   * re-defers) any cycle that fires while paused, so no charge happens. This
   * method just reports the resulting status so the sub record updates uniformly.
   */
  async pauseSubscription(providerSubscriptionId: string): Promise<FetchedSubscription> {
    return {
      providerSubscriptionId,
      status: 'paused' as unknown as FetchedSubscription['status'],
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAt: null,
      canceledAt: null,
      raw: { pausedBy: 'acepay' },
    };
  }

  /** Resume the AcePay-managed schedule — the queued cycle that was deferred
   *  while paused resumes charging once status flips back to active. */
  async resumeSubscription(providerSubscriptionId: string): Promise<FetchedSubscription> {
    return {
      providerSubscriptionId,
      status: 'active' as unknown as FetchedSubscription['status'],
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAt: null,
      canceledAt: null,
      raw: { resumedBy: 'acepay' },
    };
  }

  // ─── PaymentMethod-driven recurring charge (called by worker) ─────────

  /**
   * Charges a saved Xendit PaymentMethod for a single subscription cycle.
   * Used by the worker's SubscriptionBillingProcessor on each renewal.
   * Returns { status: SUCCEEDED | PENDING | FAILED | REQUIRES_ACTION }.
   * REQUIRES_ACTION means the customer needs to re-authenticate (3DS).
   */
  async chargeWithPaymentMethod(params: {
    paymentMethodId: string;
    xenditCustomerId: string;
    amount: number;          // smallest unit
    currency: string;
    referenceId: string;
    metadata: Record<string, unknown>;
  }): Promise<XenditChargeResult> {
    this.client();
    const resp = await this.client().PaymentRequest.createPaymentRequest({
      data: {
        referenceId: params.referenceId,
        amount: params.amount / 100,
        currency: params.currency.toUpperCase(),
        customerId: params.xenditCustomerId,
        paymentMethod: { id: params.paymentMethodId },
        metadata: stringifyMetadata(params.metadata),
      },
    });
    const status = String(resp?.status ?? 'PENDING').toUpperCase();
    return {
      paymentRequestId: String(resp?.id ?? ''),
      status: (status as XenditChargeResult['status']),
      failureCode: resp?.failureCode ?? null,
      actions: (resp?.actions ?? []) as XenditChargeResult['actions'],
      raw: resp as unknown as Record<string, unknown>,
    };
  }

  /** Ensure the AcePay customer has a matching Xendit Customer object.
   *  Returns the Xendit customer id (creates it if missing). */
  async getOrCreateXenditCustomer(opts: {
    acepayCustomerRef: string;
    email: string;
    name?: string;
    existingXenditCustomerId?: string | null;
  }): Promise<string> {
    this.client();
    if (opts.existingXenditCustomerId) return opts.existingXenditCustomerId;
    // Try by reference_id first (idempotent lookup) — falls back to create.
    try {
      const existing = await this.client().Customer.getCustomerByReferenceID({
        referenceId: opts.acepayCustomerRef,
      });
      const found = Array.isArray(existing?.data) ? existing.data[0] : null;
      if (found?.id) return String(found.id);
    } catch (err) {
      this.logger.debug(`getCustomerByReferenceID lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const created = await this.client().Customer.createCustomer({
      data: {
        referenceId: opts.acepayCustomerRef,
        email: opts.email,
        type: 'INDIVIDUAL',
        individualDetail: {
          givenNames: opts.name ?? opts.email.split('@')[0],
        },
      },
    });
    if (!created?.id) throw new Error('Xendit createCustomer returned no id');
    return String(created.id);
  }

  // ─── Webhooks ─────────────────────────────────────────────────────────

  verifyWebhook(rawBody: Buffer, signature: string | undefined): XenditInvoiceWebhook {
    // Xendit doesn't HMAC-sign webhooks — it sends a static token in
    // x-callback-token that you compare against your configured value.
    if (!signature) throw new Error('Missing x-callback-token header');
    if (!sameToken(signature, this.webhookToken())) {
      throw new Error('Invalid Xendit webhook token');
    }
    return JSON.parse(rawBody.toString('utf8')) as XenditInvoiceWebhook;
  }

  /** A reusable card finished (or failed) linking. ACTIVE is the signal that
   *  recurring is armed and cycle 1 can be charged. */
  private normalizePaymentMethodEvent(pm: XenditPaymentMethodWebhook): NormalizedEvent {
    const status = String(pm.status ?? '').toUpperCase();
    const acepaySubscriptionId =
      pm.metadata?.acepay_subscription ?? parseSubscriptionReferenceId(pm.reference_id);

    let event = 'unknown';
    switch (status) {
      case 'ACTIVE':          event = 'subscription.payment_method_linked'; break;
      case 'FAILED':
      case 'EXPIRED':         event = 'subscription.payment_method_failed'; break;
      case 'REQUIRES_ACTION':
      case 'PENDING':         event = 'subscription.payment_method_pending'; break;
      default:
        this.logger.debug(`Unmapped Xendit payment_method status: ${status}`);
    }

    return {
      event,
      providerEventId: `xendit_pm_${pm.id}_${status.toLowerCase()}`,
      providerTxId: null,
      providerSubscriptionId: acepaySubscriptionId ? String(pm.id) : null,
      acepayTxId: null,
      acepaySubscriptionId,
      status: null,
      provider: Provider.Xendit,
      raw: pm as unknown as Record<string, unknown>,
      occurredAt: pm.updated ? new Date(pm.updated) : pm.created ? new Date(pm.created) : null,
    };
  }

  normalizeEvent(payload: unknown): NormalizedEvent {
    // A payment_method callback is a different resource from an invoice: it has
    // a type/reusability and a reference_id rather than an external_id. Card
    // recurring hinges on it, so detect it before falling through to invoices.
    const pm = payload as XenditPaymentMethodWebhook;
    if (pm && typeof pm === 'object' && pm.reusability && pm.type) {
      return this.normalizePaymentMethodEvent(pm);
    }

    // Xendit Invoice webhooks deliver the invoice resource itself at the root.
    // status: 'PAID' | 'EXPIRED' | 'PENDING'
    const inv = payload as XenditInvoiceWebhook;
    const status = String(inv.status ?? '').toUpperCase();
    const metadata = inv.metadata ?? {};

    // Prefer the metadata we set, but fall back to the externalId we chose —
    // real Xendit callbacks omit metadata entirely.
    const fromExternalId = parseSubscriptionExternalId(inv.external_id);
    const acepaySubscriptionId = metadata.acepay_subscription ?? fromExternalId?.acepaySubscriptionId ?? null;
    const isSubscriptionFirstPayment = !!acepaySubscriptionId;

    let event = 'unknown';
    let txStatus: TransactionStatus | null = null;
    switch (status) {
      case 'PAID':
        event = isSubscriptionFirstPayment ? 'subscription.created' : 'payment.succeeded';
        txStatus = TransactionStatus.Succeeded; break;
      case 'EXPIRED':
        event = isSubscriptionFirstPayment ? 'subscription.payment_failed' : 'payment.failed';
        txStatus = TransactionStatus.Failed; break;
      case 'PENDING':
        event = 'payment.pending'; txStatus = TransactionStatus.Pending; break;
      default:
        this.logger.debug(`Unmapped Xendit status: ${status}`);
    }

    const occurredAt = inv.paid_at
      ? new Date(inv.paid_at)
      : inv.created
      ? new Date(inv.created)
      : null;

    return {
      event,
      providerEventId: `xendit_invoice_${inv.id}_${status.toLowerCase()}`,
      providerTxId: String(inv.id),
      providerSubscriptionId: isSubscriptionFirstPayment ? String(inv.id) : null,
      // A subscription externalId is not a transaction id; using it as one sends
      // a non-uuid into the transactions lookup and matches nothing.
      acepayTxId: metadata.acepay_tx ?? (fromExternalId ? null : inv.external_id ?? null),
      acepaySubscriptionId,
      status: txStatus,
      provider: Provider.Xendit,
      raw: inv as unknown as Record<string, unknown>,
      occurredAt,
    };
  }
}

/**
 * Invoices we create for a subscription's first cycle carry the AcePay
 * subscription id in their externalId as `sub_<uuid>_cycle_<n>` (see
 * createSubscription). Real Xendit invoice callbacks do NOT echo back the
 * `metadata` we set at creation — only the fields Xendit owns — so metadata
 * cannot be the only way we recognise a subscription payment. external_id is
 * echoed, and we chose its format, so parse the id back out of it.
 */
const SUB_EXTERNAL_ID_RE =
  /^sub_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_cycle_(\d+)$/i;

/** The referenceId we put on a subscription's PaymentMethod. Xendit echoes
 *  reference_id on payment_method callbacks, where metadata is not reliable. */
export function subscriptionReferenceId(acepaySubscriptionId: string): string {
  return `acepaysub_${acepaySubscriptionId}`;
}

const SUB_REFERENCE_ID_RE =
  /^acepaysub_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function parseSubscriptionReferenceId(referenceId: string | undefined | null): string | null {
  const m = SUB_REFERENCE_ID_RE.exec(String(referenceId ?? ''));
  return m ? m[1] : null;
}

export function parseSubscriptionExternalId(externalId: string | undefined | null): {
  acepaySubscriptionId: string; cycle: number;
} | null {
  const m = SUB_EXTERNAL_ID_RE.exec(String(externalId ?? ''));
  return m ? { acepaySubscriptionId: m[1], cycle: Number(m[2]) } : null;
}

function stringifyMetadata(md: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(md)) {
    if (v == null) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

function mapInvoiceToFetched(invoice: {
  id: string;
  paymentId?: string;
  payment_id?: string;
  status?: string;
  paid_at?: string;
  paidAt?: string;
}): FetchedPayment {
  const status = String(invoice.status ?? '').toUpperCase();
  let mapped: TransactionStatus;
  let completed: Date | null = null;
  switch (status) {
    case 'PAID':
      mapped = TransactionStatus.Succeeded;
      completed = invoice.paid_at ? new Date(invoice.paid_at)
        : invoice.paidAt ? new Date(invoice.paidAt) : null;
      break;
    case 'EXPIRED':
      mapped = TransactionStatus.Failed; break;
    default:
      mapped = TransactionStatus.Pending;
  }
  return {
    providerTxId: String(invoice.id),
    status: mapped,
    providerCompletedAt: completed,
    raw: invoice as unknown as Record<string, unknown>,
  };
}

/**
 * Constant-time token compare, so the response time never reveals how much of
 * a guessed token was right. Both sides are hashed first: timingSafeEqual
 * needs equal lengths, and comparing lengths directly would leak the length.
 */
export function sameToken(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
