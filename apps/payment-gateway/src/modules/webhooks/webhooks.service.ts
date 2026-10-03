import {
  BadRequestException, Injectable, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  LogAction, LogActor, PlanInterval, Provider, SubscriptionStatus, TransactionStatus,
  TransactionType, WebhookDeliveryStatus, XenditPaymentMethodStatus,
} from '../../common/enums';
import { SubscriptionBillingQueueService } from '../../common/queue/subscription-billing-queue.service';
import { WebhookDeliveryQueueService } from '../../common/queue/webhook-delivery-queue.service';
import { TransactionLoggerService } from '../../common/services/transaction-logger.service';
import {
  App, Customer, Subscription, Transaction, WebhookEvent,
} from '../../database/entities';
import { ProviderRegistry } from '../../payment-providers/provider.registry';
import { XenditAdapter } from '../../payment-providers/xendit.adapter';
import { NormalizedEvent } from '../../payment-providers/provider.types';

/** AcePay ids are uuids. A provider payload can carry anything in its custom
 *  data, so an id that is not a uuid must simply not match — querying a uuid
 *  column with a non-uuid string makes Postgres raise, which would turn a
 *  malformed webhook into a 500 on a public, unauthenticated endpoint. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(v: string | null | undefined): string | null {
  return typeof v === 'string' && UUID_RE.test(v) ? v : null;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(WebhookEvent) private readonly webhooks: Repository<WebhookEvent>,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(Subscription) private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    @InjectRepository(App) private readonly apps: Repository<App>,
    private readonly providers: ProviderRegistry,
    private readonly txLogger: TransactionLoggerService,
    private readonly deliveryQueue: WebhookDeliveryQueueService,
    private readonly billingQueue: SubscriptionBillingQueueService,
  ) {}

  async handle(provider: Provider, rawBody: Buffer, signature: string | undefined) {
    const adapter = this.providers.resolve(provider);
    let payload: unknown;
    try {
      payload = adapter.verifyWebhook(rawBody, signature);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException({ error: 'invalid_signature', message: msg });
    }
    const event = adapter.normalizeEvent(payload);

    // Dedup
    const existing = await this.webhooks.findOne({
      where: { provider, providerEventId: event.providerEventId },
    });
    if (existing) {
      this.logger.debug(`Duplicate event ${event.providerEventId} — already processed`);
      return { duplicate: true, eventId: existing.id };
    }

    const isSubscriptionEvent = event.event.startsWith('subscription.')
      || event.acepaySubscriptionId != null
      || event.providerSubscriptionId != null;

    if (isSubscriptionEvent) {
      return this.handleSubscriptionEvent(provider, event);
    }
    return this.handlePaymentEvent(provider, event);
  }

  // ─── Payment events (one-time charges + refunds) ─────────────────────

  private async handlePaymentEvent(provider: Provider, event: NormalizedEvent) {
    const tx = await this.resolveTransaction(event);
    const app = tx
      ? (await this.apps.findOne({ where: { id: tx.appId } })) ?? null
      : null;

    if (tx && event.status && event.status !== tx.status) {
      const previous = tx.status;
      tx.status = event.status;
      tx.webhookReceivedAt = new Date();
      if (event.status === TransactionStatus.Succeeded || event.status === TransactionStatus.Refunded) {
        tx.providerCompletedAt ??= event.occurredAt ?? new Date();
      }
      // Swap providerTxId from checkout id (UUID) to order id once we have it.
      if (event.providerTxId && event.providerTxId !== tx.providerTxId) {
        tx.providerTxId = event.providerTxId;
      }
      await this.transactions.save(tx);

      await this.txLogger.log({
        transaction: tx,
        action: LogAction.PaymentWebhookReceived,
        actor: LogActor.Provider,
        statusFrom: previous, statusTo: previous,
        providerEventId: event.providerEventId,
        details: { event: event.event },
      });
      const action = mapEventToAction(event.event);
      if (action) {
        await this.txLogger.log({
          transaction: tx,
          action,
          actor: LogActor.Provider,
          statusFrom: previous, statusTo: tx.status,
          providerEventId: event.providerEventId,
        });
      }
    }

    return this.persistAndDeliver(provider, event, tx?.appId ?? app?.id ?? null, tx?.id ?? null, tx, app);
  }

  // ─── Subscription events ─────────────────────────────────────────────

  private async handleSubscriptionEvent(provider: Provider, event: NormalizedEvent) {
    const sub = await this.resolveSubscription(event);
    const app = sub
      ? (await this.apps.findOne({ where: { id: sub.appId } })) ?? null
      : null;

    // The transaction this event produced, whichever branch creates it, so the
    // stored webhook event can be linked back to it.
    let recordedTx: Transaction | null = null;

    if (sub) {
      let dirty = false;

      // First-time confirmation: swap the placeholder providerSubscriptionId
      // (which is the checkout id) to the real LS subscription id.
      if (event.providerSubscriptionId && event.providerSubscriptionId !== sub.providerSubscriptionId) {
        // provider_subscription_id is UNIQUE. If another row already holds this
        // id the swap raises, and because this is a public webhook endpoint the
        // provider then retries the 500 forever. Skip the swap and say so: the
        // identity fix is best-effort, and a collision means the data is already
        // inconsistent, which a retry loop will not resolve.
        const clash = await this.subscriptions.findOne({
          where: { providerSubscriptionId: event.providerSubscriptionId },
        });
        if (clash && clash.id !== sub.id) {
          this.logger.warn(
            `Cannot point subscription ${sub.id} at provider subscription `
            + `${event.providerSubscriptionId}: already held by ${clash.id}. Leaving it unchanged.`,
          );
        } else {
          sub.providerSubscriptionId = event.providerSubscriptionId;
          dirty = true;
        }
      }

      if (event.subscriptionStatus && event.subscriptionStatus !== sub.status) {
        sub.status = event.subscriptionStatus;
        dirty = true;
      }

      // Card-only recurring: the reusable card finished linking, so arm recurring
      // and charge cycle 1 ourselves. This replaces the old invoice-first flow,
      // which produced a one-off charge and nothing reusable.
      if (event.event === 'subscription.payment_method_linked') {
        recordedTx = await this.handleXenditCardLinked(sub, event);
        dirty = true;
      }

      if (event.event === 'subscription.payment_method_failed') {
        const meta = (sub.metadata ?? {}) as Record<string, unknown>;
        delete meta.awaitingFirstPayment;
        delete meta.checkoutUrl;
        sub.metadata = {
          ...meta,
          recurringUnavailable: true,
          recurringUnavailableReason: 'card_link_failed',
        };
        sub.status = SubscriptionStatus.PastDue;
        dirty = true;
      }

      if (event.event === 'subscription.created' || event.event === 'subscription.payment_succeeded') {
        // Clear the awaiting-first-payment flag, fill in period dates from the raw payload.
        const meta = (sub.metadata ?? {}) as Record<string, unknown>;
        if (meta.awaitingFirstPayment) {
          delete meta.awaitingFirstPayment;
          delete meta.checkoutUrl;
          sub.metadata = meta;
          dirty = true;
        }
        const periodEnd = extractRenewsAt(event.raw);
        if (periodEnd) {
          sub.currentPeriodEnd = periodEnd;
          sub.currentPeriodStart ??= event.occurredAt ?? new Date();
          dirty = true;
        }

        // Xendit first-payment: invoice.paid arrives with payment_method_id.
        // Save it on the Customer so the billing processor can reuse it,
        // then schedule cycle #2 at currentPeriodEnd.
        if (event.provider === Provider.Xendit && sub.provider === Provider.Xendit) {
          recordedTx = await this.handleXenditFirstPayment(sub, event);
        }
      }

      // Lemon Squeezy refunds require an ORDER id, and the charge event
      // (subscription_payment_success) carries only a subscription-invoice id.
      // order_created is the only event with the order id, so capture it:
      // backfill the charge row if it already exists, otherwise stash it for the
      // charge event to pick up. Without this an LS subscription payment can
      // never be refunded, because issueOrderRefund has nothing to act on.
      if (event.event === 'payment.succeeded' && event.providerTxId) {
        const unlinked = await this.transactions.findOne({
          where: {
            subscriptionId: sub.id,
            type: TransactionType.SubscriptionPayment,
            providerTxId: IsNull(),
          },
          order: { createdAt: 'DESC' },
        });
        if (unlinked) {
          unlinked.providerTxId = event.providerTxId;
          await this.transactions.save(unlinked);
        } else {
          sub.metadata = { ...(sub.metadata ?? {}), pendingOrderId: event.providerTxId };
          dirty = true;
        }
      }

      if (event.event === 'subscription.canceled' && !sub.canceledAt) {
        sub.canceledAt = event.occurredAt ?? new Date();
        dirty = true;
      }

      if (dirty) await this.subscriptions.save(sub);
    } else {
      this.logger.warn(
        `Subscription event ${event.providerEventId} has no matching AcePay subscription — ` +
        `acepaySubscriptionId=${event.acepaySubscriptionId} providerSubscriptionId=${event.providerSubscriptionId}`,
      );
    }

    // Record a subscription_payment Transaction.
    //
    // Only the subscription.payment_* events qualify. Lemon Squeezy emits FOUR
    // events for one first charge — order_created, subscription_created,
    // subscription_updated and subscription_payment_success — and the last one
    // is what records the charge. Treating order_created as a charge too (it
    // normalizes to payment.succeeded and carries the subscription in
    // custom_data) records the same payment twice.
    if (sub && app && (event.event === 'subscription.payment_succeeded' || event.event === 'subscription.payment_failed')) {
      const txStatus = event.status ?? (event.event === 'subscription.payment_succeeded'
        ? TransactionStatus.Succeeded : TransactionStatus.Failed);
      const amount = sub.plan?.amount ?? extractAmount(event.raw) ?? 0;
      const currency = sub.plan?.currency ?? extractCurrency(event.raw) ?? 'PHP';
      const ptx = this.transactions.create({
        appId: sub.appId,
        customerId: sub.customerId,
        subscriptionId: sub.id,
        provider: sub.provider,
        // Needed for refunds later: for Lemon Squeezy this is the numeric order
        // id, which is the only id issueOrderRefund accepts.
        // Fall back to the order id captured from order_created, since the
        // charge event itself carries only a subscription-invoice id.
        providerTxId: event.providerTxId
          ?? (sub.metadata as Record<string, unknown> | undefined)?.pendingOrderId as string
          ?? null,
        type: TransactionType.SubscriptionPayment,
        status: txStatus,
        amount,
        currency,
        description: `Subscription billing — ${sub.plan?.name ?? 'plan'}`,
        webhookReceivedAt: new Date(),
        providerCompletedAt: event.occurredAt ?? new Date(),
      });
      recordedTx = await this.transactions.save(ptx);
      if ((sub.metadata as Record<string, unknown> | undefined)?.pendingOrderId) {
        const meta = { ...(sub.metadata as Record<string, unknown>) };
        delete meta.pendingOrderId;
        sub.metadata = meta;
        await this.subscriptions.save(sub);
      }

      // Without this the transaction has no movement log at all: the admin's
      // activity feed and every subscription transaction's timeline stay empty,
      // because handlePaymentEvent was the only path that ever logged.
      await this.txLogger.log({
        transaction: recordedTx,
        action: txStatus === TransactionStatus.Succeeded
          ? LogAction.SubscriptionPaymentSucceeded
          : LogAction.SubscriptionPaymentFailed,
        actor: LogActor.Provider,
        statusFrom: txStatus, statusTo: txStatus,
        providerEventId: event.providerEventId,
        details: { event: event.event, subscriptionId: sub.id },
      });
    }

    // Link the event to the transaction it produced, so the transaction's
    // "related webhook events" panel and the delivery payload both resolve.
    return this.persistAndDeliver(
      provider, event, sub?.appId ?? null, recordedTx?.id ?? null, recordedTx, app,
    );
  }

  // ─── Shared persistence + delivery ───────────────────────────────────

  private async persistAndDeliver(
    provider: Provider,
    event: NormalizedEvent,
    appId: string | null,
    transactionId: string | null,
    tx: Transaction | null,
    app: App | null,
  ) {
    if (!appId) {
      this.logger.warn(`Webhook event ${event.providerEventId} could not be associated with an app — skipping delivery`);
      return { duplicate: false, eventId: null, reason: 'no_app_match' };
    }
    const normalized = buildNormalizedPayload(event, tx);
    let webhookEvent = this.webhooks.create({
      appId,
      transactionId,
      provider,
      eventType: event.event,
      providerEventId: event.providerEventId,
      providerPayload: event.raw,
      normalizedPayload: normalized,
      deliveryStatus: WebhookDeliveryStatus.Pending,
      attempts: 0,
      maxAttempts: 5,
    });
    webhookEvent = await this.webhooks.save(webhookEvent);
    // Hand off to the worker via Bull — the worker drains the queue, POSTs the
    // signed payload, and updates webhookEvent.deliveryStatus + retry state.
    if (app) {
      await this.deliveryQueue.enqueue({
        webhookEventId: webhookEvent.id,
        transactionId: tx?.id ?? null,
      });
    }
    return { duplicate: false, eventId: webhookEvent.id };
  }

  private async resolveTransaction(event: NormalizedEvent): Promise<Transaction | null> {
    const acepayTxId = asUuid(event.acepayTxId);
    if (acepayTxId) {
      const tx = await this.transactions.findOne({ where: { id: acepayTxId } });
      if (tx) return tx;
    }
    if (event.providerTxId) {
      return this.transactions.findOne({
        where: { providerTxId: event.providerTxId, provider: event.provider },
      });
    }
    return null;
  }

  /** Xendit-specific: invoice.paid for a subscription's first cycle carries
   *  the saved payment_method_id. Persist it on the Customer, backfill a
   *  Transaction row for cycle 1, and schedule cycle 2 at plan.interval. */
  /**
   * The customer finished linking a reusable card. Save it, charge cycle 1
   * through the PaymentRequest API, record the transaction and schedule cycle 2.
   * Any failure here leaves the subscription visibly unarmed rather than
   * silently waiting for a charge that can never happen.
   */
  private async handleXenditCardLinked(sub: Subscription, event: NormalizedEvent): Promise<Transaction | null> {
    const raw = event.raw as Record<string, unknown>;
    const pmId = String(raw.id ?? '');
    if (!sub.customerId || !pmId) return null;

    const customer = await this.customers.findOne({ where: { id: sub.customerId } });
    if (customer) {
      customer.xenditPaymentMethodId = pmId;
      customer.xenditPaymentMethodStatus = XenditPaymentMethodStatus.Active;
      await this.customers.save(customer);
    }

    const meta = (sub.metadata ?? {}) as Record<string, unknown>;
    delete meta.awaitingFirstPayment;
    delete meta.checkoutUrl;
    delete meta.recurringUnavailable;
    delete meta.recurringUnavailableReason;
    sub.metadata = meta;

    if (!sub.plan) return null;

    // Charge cycle 1 now — with a reusable card there is no invoice to wait on.
    let charge;
    try {
      // chargeWithPaymentMethod is Xendit-specific, not part of the shared
      // PaymentProvider contract, so resolve the concrete adapter.
      const xendit = this.providers.resolve(Provider.Xendit) as unknown as XenditAdapter;
      charge = await xendit.chargeWithPaymentMethod({
          paymentMethodId: pmId,
          xenditCustomerId: String(raw.customer_id ?? customer?.xenditCustomerId ?? ''),
          amount: sub.plan.amount,
          currency: sub.plan.currency,
          referenceId: `sub_${sub.id}_cycle_1`,
          metadata: { acepay_subscription: sub.id, cycle: 1 },
        });
    } catch (err) {
      this.logger.error(
        `Cycle 1 charge failed for sub ${sub.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      sub.status = SubscriptionStatus.PastDue;
      return null;
    }

    const succeeded = charge.status === 'SUCCEEDED';
    const cycle1 = await this.transactions.save(this.transactions.create({
      appId: sub.appId,
      customerId: sub.customerId,
      subscriptionId: sub.id,
      provider: Provider.Xendit,
      providerTxId: charge.paymentRequestId,
      type: TransactionType.SubscriptionPayment,
      status: succeeded ? TransactionStatus.Succeeded : TransactionStatus.Failed,
      amount: sub.plan.amount,
      currency: sub.plan.currency,
      description: `${sub.plan.name} — cycle 1`,
      providerCompletedAt: event.occurredAt ?? new Date(),
      webhookReceivedAt: new Date(),
    }));

    await this.txLogger.log({
      transaction: cycle1,
      action: succeeded ? LogAction.SubscriptionPaymentSucceeded : LogAction.SubscriptionPaymentFailed,
      actor: LogActor.Provider,
      statusFrom: cycle1.status, statusTo: cycle1.status,
      providerEventId: event.providerEventId,
      details: { event: event.event, subscriptionId: sub.id, cycle: 1 },
    });

    if (!succeeded) {
      sub.status = SubscriptionStatus.PastDue;
      return cycle1;
    }

    const nextCycleAt = addPlanInterval(new Date(), sub.plan.interval, sub.plan.intervalCount);
    sub.currentPeriodStart ??= new Date();
    sub.currentPeriodEnd = nextCycleAt;
    await this.billingQueue.enqueue(
      { subscriptionId: sub.id, cycleNumber: 2 },
      Math.max(0, nextCycleAt.getTime() - Date.now()),
    );
    this.logger.log(`Xendit sub ${sub.id} armed; cycle 2 at ${nextCycleAt.toISOString()}`);
    return cycle1;
  }

  private async handleXenditFirstPayment(sub: Subscription, event: NormalizedEvent): Promise<Transaction | null> {
    if (!sub.customerId) return null;
    const raw = event.raw as Record<string, unknown>;
    const pmId = (raw.payment_method_id ?? raw.payment_id) as string | undefined;
    let cycle1: Transaction | null = null;

    // A missing payment method only blocks RECURRING. The customer has still
    // paid cycle 1, so the transaction, the billing period and the next cycle
    // must be recorded regardless — bailing out here meant a real paid
    // subscription had no billing record at all. Real Xendit invoice callbacks
    // do not carry payment_method_id, so this is the normal path, not an edge.
    if (pmId) {
      const customer = await this.customers.findOne({ where: { id: sub.customerId } });
      if (customer) {
        customer.xenditPaymentMethodId = String(pmId);
        customer.xenditPaymentMethodStatus = XenditPaymentMethodStatus.Active;
        await this.customers.save(customer);
      }
    } else {
      this.logger.warn(
        `Xendit first-payment for sub ${sub.id} carried no payment_method_id — cycle 1 is ` +
        `recorded, but no reusable payment method was saved so cycle 2 cannot be charged.`,
      );
      // Make this visible NOW rather than as a surprise failed charge a billing
      // period later. The operator can see on the subscription that recurring is
      // not armed, and act before the customer is affected.
      sub.metadata = {
        ...(sub.metadata ?? {}),
        recurringUnavailable: true,
        recurringUnavailableReason: 'xendit_invoice_callback_carried_no_payment_method_id',
      };
      await this.subscriptions.save(sub);
    }

    // Record cycle 1 as a subscription_payment Transaction so billing history
    // starts from day one instead of from cycle 2. Amount comes from the plan
    // (the Xendit invoice was created with this amount via metadata).
    if (sub.plan) {
      const cycle1Tx = this.transactions.create({
        appId: sub.appId,
        customerId: sub.customerId,
        subscriptionId: sub.id,
        provider: Provider.Xendit,
        providerTxId: String(event.providerTxId ?? raw.id ?? ''),
        type: TransactionType.SubscriptionPayment,
        status: TransactionStatus.Succeeded,
        amount: sub.plan.amount,
        currency: sub.plan.currency,
        description: `${sub.plan.name} — cycle 1`,
        providerCompletedAt: event.occurredAt ?? new Date(),
        webhookReceivedAt: new Date(),
      });
      cycle1 = await this.transactions.save(cycle1Tx);
      await this.txLogger.log({
        transaction: cycle1,
        action: LogAction.SubscriptionPaymentSucceeded,
        actor: LogActor.Provider,
        statusFrom: TransactionStatus.Succeeded, statusTo: TransactionStatus.Succeeded,
        providerEventId: event.providerEventId,
        details: { event: event.event, subscriptionId: sub.id, cycle: 1 },
      });
    }

    // Schedule cycle 2 at plan.interval from now.
    if (sub.plan) {
      const nextCycleAt = addPlanInterval(new Date(), sub.plan.interval, sub.plan.intervalCount);
      sub.currentPeriodEnd = nextCycleAt;
      sub.currentPeriodStart ??= new Date();
      await this.subscriptions.save(sub);
      await this.billingQueue.enqueue(
        { subscriptionId: sub.id, cycleNumber: 2 },
        Math.max(0, nextCycleAt.getTime() - Date.now()),
      );
      this.logger.log(`Scheduled Xendit sub ${sub.id} cycle 2 at ${nextCycleAt.toISOString()}`);
    }
    return cycle1;
  }

  private async resolveSubscription(event: NormalizedEvent): Promise<Subscription | null> {
    const acepaySubscriptionId = asUuid(event.acepaySubscriptionId);
    if (acepaySubscriptionId) {
      const sub = await this.subscriptions.findOne({
        where: { id: acepaySubscriptionId },
        relations: { plan: true },
      });
      if (sub) return sub;
    }
    if (event.providerSubscriptionId) {
      return this.subscriptions.findOne({
        where: { providerSubscriptionId: event.providerSubscriptionId, provider: event.provider },
        relations: { plan: true },
      });
    }
    return null;
  }
}

function mapEventToAction(event: string): LogAction | null {
  switch (event) {
    case 'payment.succeeded':  return LogAction.PaymentSucceeded;
    case 'payment.failed':     return LogAction.PaymentFailed;
    case 'refund.succeeded':   return LogAction.PaymentRefunded;
    default:                   return null;
  }
}

function buildNormalizedPayload(event: NormalizedEvent, tx: Transaction | null): Record<string, unknown> {
  return {
    event: event.event,
    transaction_id: tx?.id ?? null,
    subscription_id: event.acepaySubscriptionId ?? null,
    provider: event.provider,
    amount: tx?.amount ?? null,
    currency: tx?.currency ?? null,
    metadata: tx?.metadata ?? {},
    // Marketplace payments (Slice 6) carry the split so the app can show the
    // merchant their share. Absent for subscription / non-marketplace payments.
    ...(tx?.merchantId ? {
      marketplace: {
        merchant_id: tx.merchantId,
        fee_percent: tx.platformFeePercent ?? null,
        platform_fee: tx.platformFeeAmount ?? null,
        merchant_amount: tx.merchantAmount ?? null,
      },
    } : {}),
    timestamps: {
      created_at: tx?.createdAt ?? null,
      provider_completed_at: tx?.providerCompletedAt ?? null,
      webhook_received_at: tx?.webhookReceivedAt ?? null,
    },
  };
}

function addPlanInterval(from: Date, interval: PlanInterval, count: number): Date {
  const d = new Date(from);
  switch (interval) {
    case PlanInterval.Weekly:  d.setDate(d.getDate() + 7 * count); break;
    case PlanInterval.Monthly: d.setMonth(d.getMonth() + 1 * count); break;
    case PlanInterval.Yearly:  d.setFullYear(d.getFullYear() + 1 * count); break;
    default:                   d.setMonth(d.getMonth() + 1); break;
  }
  return d;
}

function extractRenewsAt(raw: Record<string, unknown>): Date | null {
  const data = (raw as { data?: { attributes?: { renews_at?: string } } }).data;
  const renews = data?.attributes?.renews_at;
  return renews ? new Date(renews) : null;
}

function extractAmount(raw: Record<string, unknown>): number | null {
  const data = (raw as { data?: { attributes?: { total?: number; total_in_dollars?: number } } }).data;
  return data?.attributes?.total ?? null;
}

function extractCurrency(raw: Record<string, unknown>): string | null {
  const data = (raw as { data?: { attributes?: { currency?: string } } }).data;
  return data?.attributes?.currency ?? null;
}

