import {
  BadRequestException, Injectable, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LogAction, LogActor, PlanInterval, Provider, TransactionStatus,
  TransactionType, WebhookDeliveryStatus, XenditPaymentMethodStatus,
} from '../../common/enums';
import { SubscriptionBillingQueueService } from '../../common/queue/subscription-billing-queue.service';
import { WebhookDeliveryQueueService } from '../../common/queue/webhook-delivery-queue.service';
import { TransactionLoggerService } from '../../common/services/transaction-logger.service';
import {
  App, Customer, Subscription, Transaction, WebhookEvent,
} from '../../database/entities';
import { ProviderRegistry } from '../../payment-providers/provider.registry';
import { NormalizedEvent } from '../../payment-providers/provider.types';

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

    if (sub) {
      let dirty = false;

      // First-time confirmation: swap the placeholder providerSubscriptionId
      // (which is the checkout id) to the real LS subscription id.
      if (event.providerSubscriptionId && event.providerSubscriptionId !== sub.providerSubscriptionId) {
        sub.providerSubscriptionId = event.providerSubscriptionId;
        dirty = true;
      }

      if (event.subscriptionStatus && event.subscriptionStatus !== sub.status) {
        sub.status = event.subscriptionStatus;
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
          await this.handleXenditFirstPayment(sub, event);
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

    // For subscription_payment_* events, record a subscription_payment Transaction.
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
        type: TransactionType.SubscriptionPayment,
        status: txStatus,
        amount,
        currency,
        description: `Subscription billing — ${sub.plan?.name ?? 'plan'}`,
        webhookReceivedAt: new Date(),
        providerCompletedAt: event.occurredAt ?? new Date(),
      });
      await this.transactions.save(ptx);
    }

    return this.persistAndDeliver(provider, event, sub?.appId ?? null, null, null, app);
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
    if (event.acepayTxId) {
      const tx = await this.transactions.findOne({ where: { id: event.acepayTxId } });
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
  private async handleXenditFirstPayment(sub: Subscription, event: NormalizedEvent): Promise<void> {
    if (!sub.customerId) return;
    const raw = event.raw as Record<string, unknown>;
    const pmId = (raw.payment_method_id ?? raw.payment_id) as string | undefined;
    if (!pmId) {
      this.logger.warn(`Xendit first-payment for sub ${sub.id} has no payment_method_id — recurring will not work`);
      return;
    }
    const customer = await this.customers.findOne({ where: { id: sub.customerId } });
    if (customer) {
      customer.xenditPaymentMethodId = String(pmId);
      customer.xenditPaymentMethodStatus = XenditPaymentMethodStatus.Active;
      await this.customers.save(customer);
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
      await this.transactions.save(cycle1Tx);
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
  }

  private async resolveSubscription(event: NormalizedEvent): Promise<Subscription | null> {
    if (event.acepaySubscriptionId) {
      const sub = await this.subscriptions.findOne({
        where: { id: event.acepaySubscriptionId },
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

