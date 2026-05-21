import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Job } from 'bull';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { SubscriptionBillingJob } from '../../../../payment-gateway/src/common/queue/subscription-billing-queue.service';
import { SUBSCRIPTION_BILLING_QUEUE } from '../../../../payment-gateway/src/common/queue/queue.module';
import { SubscriptionBillingQueueService } from '../../../../payment-gateway/src/common/queue/subscription-billing-queue.service';
import { WebhookDeliveryQueueService } from '../../../../payment-gateway/src/common/queue/webhook-delivery-queue.service';
import {
  PlanInterval, Provider, SubscriptionStatus, TransactionStatus, TransactionType,
  WebhookDeliveryStatus,
} from '../../../../payment-gateway/src/common/enums';
import { XenditAdapter } from '../../../../payment-gateway/src/payment-providers/xendit.adapter';
import {
  Subscription, Transaction, WebhookEvent,
} from '../../../../payment-gateway/src/database/entities';

/**
 * Drains subscription-billing jobs. For each job:
 *  - Loads the AcePay Subscription + Customer + Plan.
 *  - If Xendit: calls adapter.chargeWithPaymentMethod against the customer's
 *    saved PaymentMethod (collected during first-payment).
 *  - If Lemon Squeezy: skips — LS handles its own billing schedule.
 *  - On success: records a subscription_payment Transaction, advances
 *    currentPeriodEnd, and schedules the next cycle.
 *  - On failure: marks the subscription past_due and emits an outbound webhook.
 */
@Processor(SUBSCRIPTION_BILLING_QUEUE)
export class SubscriptionBillingProcessor {
  private readonly logger = new Logger(SubscriptionBillingProcessor.name);

  constructor(
    @InjectRepository(Subscription) private readonly subs: Repository<Subscription>,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(WebhookEvent) private readonly webhooks: Repository<WebhookEvent>,
    private readonly xendit: XenditAdapter,
    private readonly billingQueue: SubscriptionBillingQueueService,
    private readonly deliveryQueue: WebhookDeliveryQueueService,
  ) {}

  @Process()
  async handle(job: Job<SubscriptionBillingJob>): Promise<void> {
    const { subscriptionId, cycleNumber } = job.data;
    const sub = await this.subs.findOne({
      where: { id: subscriptionId },
      relations: { plan: true, customer: true, app: true },
    });
    if (!sub) {
      this.logger.warn(`Subscription ${subscriptionId} no longer exists — dropping billing job`);
      return;
    }
    if (sub.status === SubscriptionStatus.Expired) {
      this.logger.log(`Sub ${subscriptionId} already expired — dropping cycle ${cycleNumber}`);
      return;
    }
    if (sub.status === SubscriptionStatus.Canceled) {
      // Customer canceled mid-period and access carried through to this point.
      // Record an audit Transaction (no charge), transition the sub to Expired,
      // notify the app, and stop scheduling future cycles.
      this.logger.log(`Sub ${subscriptionId} canceled — recording cancel-cycle ${cycleNumber} and expiring`);
      const cancelTx = this.transactions.create({
        appId: sub.appId,
        customerId: sub.customerId,
        subscriptionId: sub.id,
        provider: sub.provider,
        type: TransactionType.SubscriptionPayment,
        status: TransactionStatus.Canceled,
        amount: sub.plan?.amount ?? 0,
        currency: sub.plan?.currency ?? 'PHP',
        description: `${sub.plan?.name ?? 'Plan'} — cycle ${cycleNumber} skipped (subscription canceled)`,
        providerCompletedAt: null,
        webhookReceivedAt: new Date(),
      });
      const savedCancelTx = await this.transactions.save(cancelTx);

      sub.status = SubscriptionStatus.Expired;
      await this.subs.save(sub);

      await this.emitWebhook(sub, savedCancelTx, 'subscription.expired');
      return;
    }
    if (sub.provider !== Provider.Xendit) {
      this.logger.debug(`Sub ${subscriptionId} provider=${sub.provider} — billing handled by provider, not AcePay`);
      return;
    }
    if (!sub.customer?.xenditPaymentMethodId || !sub.customer.xenditCustomerId) {
      this.logger.warn(`Sub ${subscriptionId} customer has no saved PaymentMethod — cannot bill cycle ${cycleNumber}`);
      sub.status = SubscriptionStatus.PastDue;
      await this.subs.save(sub);
      return;
    }
    if (!sub.plan) {
      this.logger.error(`Sub ${subscriptionId} has no plan loaded — cannot bill`);
      return;
    }

    this.logger.log(`Billing Xendit sub ${subscriptionId} cycle ${cycleNumber} for ${sub.plan.amount} ${sub.plan.currency}`);
    const referenceId = `acepay_sub_${sub.id}_cycle_${cycleNumber}_${randomUUID().slice(0, 8)}`;
    let charge;
    try {
      charge = await this.xendit.chargeWithPaymentMethod({
        paymentMethodId: sub.customer.xenditPaymentMethodId,
        xenditCustomerId: sub.customer.xenditCustomerId,
        amount: sub.plan.amount,
        currency: sub.plan.currency,
        referenceId,
        metadata: {
          acepay_subscription: sub.id,
          acepay_customer: sub.customerId,
          app_slug: sub.app?.slug ?? '',
          cycle: cycleNumber,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Xendit charge threw for sub ${subscriptionId}: ${msg}`);
      throw err; // Bull retries per queue policy
    }

    const isSuccess = charge.status === 'SUCCEEDED';
    const isPending = charge.status === 'PENDING' || charge.status === 'REQUIRES_ACTION';

    const tx = this.transactions.create({
      appId: sub.appId,
      customerId: sub.customerId,
      subscriptionId: sub.id,
      provider: Provider.Xendit,
      providerTxId: charge.paymentRequestId,
      type: TransactionType.SubscriptionPayment,
      status: isSuccess
        ? TransactionStatus.Succeeded
        : isPending
        ? TransactionStatus.Pending
        : TransactionStatus.Failed,
      amount: sub.plan.amount,
      currency: sub.plan.currency,
      description: `${sub.plan.name} — cycle ${cycleNumber}`,
      providerCompletedAt: isSuccess ? new Date() : null,
      webhookReceivedAt: new Date(),
    });
    const savedTx = await this.transactions.save(tx);

    if (isSuccess) {
      // Advance the subscription's period + schedule the next cycle.
      const nextPeriodEnd = addInterval(new Date(), sub.plan.interval, sub.plan.intervalCount);
      sub.currentPeriodStart = new Date();
      sub.currentPeriodEnd = nextPeriodEnd;
      sub.status = SubscriptionStatus.Active;
      await this.subs.save(sub);

      const msUntilNext = nextPeriodEnd.getTime() - Date.now();
      await this.billingQueue.enqueue(
        { subscriptionId: sub.id, cycleNumber: cycleNumber + 1 },
        Math.max(0, msUntilNext),
      );
      await this.emitWebhook(sub, savedTx, 'subscription.payment_succeeded');
    } else if (!isPending) {
      sub.status = SubscriptionStatus.PastDue;
      await this.subs.save(sub);
      await this.emitWebhook(sub, savedTx, 'subscription.payment_failed');
      // Don't throw — failed payment is a "normal" outcome; we don't want Bull to retry
      // the same cycle endlessly. Smart-retry is a follow-up (track failures on the sub).
    }
  }

  private async emitWebhook(sub: Subscription, tx: Transaction, event: string): Promise<void> {
    const webhook = this.webhooks.create({
      appId: sub.appId,
      transactionId: tx.id,
      provider: Provider.Xendit,
      eventType: event,
      providerEventId: `acepay_${event}_${tx.id}`,
      providerPayload: { source: 'acepay_billing_processor', transactionId: tx.id },
      normalizedPayload: {
        event,
        subscription_id: sub.id,
        transaction_id: tx.id,
        provider: Provider.Xendit,
        amount: tx.amount,
        currency: tx.currency,
        metadata: sub.metadata ?? {},
        timestamps: {
          created_at: tx.createdAt,
          provider_completed_at: tx.providerCompletedAt,
          webhook_received_at: tx.webhookReceivedAt,
        },
      },
      deliveryStatus: WebhookDeliveryStatus.Pending,
    });
    const saved = await this.webhooks.save(webhook);
    await this.deliveryQueue.enqueue({ webhookEventId: saved.id, transactionId: tx.id });
  }
}

function addInterval(from: Date, interval: PlanInterval, count: number): Date {
  const d = new Date(from);
  switch (interval) {
    case PlanInterval.Weekly:  d.setDate(d.getDate() + 7 * count); break;
    case PlanInterval.Monthly: d.setMonth(d.getMonth() + 1 * count); break;
    case PlanInterval.Yearly:  d.setFullYear(d.getFullYear() + 1 * count); break;
    default:                   d.setMonth(d.getMonth() + 1); break;
  }
  return d;
}
