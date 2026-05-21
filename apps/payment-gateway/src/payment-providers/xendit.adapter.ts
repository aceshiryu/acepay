import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Xendit } from 'xendit-node';
import { Provider, TransactionStatus } from '../common/enums';
import {
  CreatePaymentParams, CreatePaymentResult, CreateSubscriptionParams, CreateSubscriptionResult,
  FetchedPayment, FetchedSubscription, NormalizedEvent, PaymentProvider, RefundResult,
} from './provider.types';

const PAUSE_RESUME_NOT_SUPPORTED =
  'Xendit subscriptions are AcePay-managed (we own the schedule). Cancel works; pause/resume ' +
  'require additional work to interleave with the billing queue — coming in Slice 4c.';

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

  async getPayment(providerTxId: string): Promise<FetchedPayment> {
    const invoice = await this.client().Invoice.getInvoiceById({ invoiceId: providerTxId });
    return mapInvoiceToFetched(invoice);
  }

  async refund(providerTxId: string, amount?: number): Promise<RefundResult> {
    // Refunds need a payment_id, not the invoice_id. Fetch the invoice to resolve it.
    const invoice = await this.client().Invoice.getInvoiceById({ invoiceId: providerTxId });
    const paymentId: string | undefined = invoice?.paymentId ?? invoice?.payment_id;
    if (!paymentId) {
      throw new Error(`Cannot refund Xendit invoice ${providerTxId} — no payment_id (likely unpaid)`);
    }
    const refund = await this.client().Refund.createRefund({
      data: {
        paymentRequestId: paymentId,
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
  async createSubscription(p: CreateSubscriptionParams): Promise<CreateSubscriptionResult> {
    this.client();
    // Resolve / create the Xendit Customer so the invoice + future PM are linked.
    const xenditCustomerId = await this.getOrCreateXenditCustomer({
      acepayCustomerRef: `acepay_${p.appSlug}_${p.acepaySubscriptionId}`,
      email: p.customer.email,
      name: p.customer.name,
    });

    // Xendit expects amount in MAJOR units. The plan.amount in callers is in
    // smallest unit (centavos), so divide by 100 when calling.
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

  async pauseSubscription(_id: string): Promise<FetchedSubscription> {
    throw new Error(PAUSE_RESUME_NOT_SUPPORTED);
  }
  async resumeSubscription(_id: string): Promise<FetchedSubscription> {
    throw new Error(PAUSE_RESUME_NOT_SUPPORTED);
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
    if (signature !== this.webhookToken()) {
      throw new Error('Invalid Xendit webhook token');
    }
    return JSON.parse(rawBody.toString('utf8')) as XenditInvoiceWebhook;
  }

  normalizeEvent(payload: unknown): NormalizedEvent {
    // Xendit Invoice webhooks deliver the invoice resource itself at the root.
    // status: 'PAID' | 'EXPIRED' | 'PENDING'
    const inv = payload as XenditInvoiceWebhook;
    const status = String(inv.status ?? '').toUpperCase();
    const metadata = inv.metadata ?? {};

    const acepaySubscriptionId = metadata.acepay_subscription ?? null;
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
      acepayTxId: metadata.acepay_tx ?? inv.external_id ?? null,
      acepaySubscriptionId,
      status: txStatus,
      provider: Provider.Xendit,
      raw: inv as unknown as Record<string, unknown>,
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
