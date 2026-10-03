import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Provider, WebhookDeliveryStatus } from '../../common/enums';
import { WebhookDeliveryQueueService } from '../../common/queue/webhook-delivery-queue.service';
import { Merchant, Payout, WebhookEvent } from '../../database/entities';
import { maskAccount } from './marketplace.util';

export type MerchantEventType =
  | 'merchant.activated'
  | 'merchant.suspended'
  | 'merchant.payout_sent'
  | 'merchant.payout_failed';

/**
 * Tells the owning app about merchant + payout changes through the normal
 * signed webhook pipeline (WebhookEvent row → Bull → worker POST). Each event
 * carries a deterministic id, so a repeated Xendit callback never notifies the
 * app twice.
 */
@Injectable()
export class MerchantEventsService {
  private readonly logger = new Logger(MerchantEventsService.name);

  constructor(
    @InjectRepository(WebhookEvent) private readonly webhooks: Repository<WebhookEvent>,
    private readonly deliveryQueue: WebhookDeliveryQueueService,
  ) {}

  async emit(
    type: MerchantEventType,
    merchant: Merchant,
    opts: { eventKey: string; payout?: Payout | null; raw?: Record<string, unknown> },
  ): Promise<void> {
    const providerEventId = `acepay_${type}_${opts.eventKey}`;
    const dup = await this.webhooks.findOne({ where: { provider: Provider.Xendit, providerEventId } });
    if (dup) return;

    const p = opts.payout;
    const normalized: Record<string, unknown> = {
      event: type,
      merchant_id: merchant.id,
      external_ref: merchant.externalRef,
      merchant_status: merchant.status,
      payout: p ? {
        id: p.id,
        run_id: p.runId ?? null,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        channel_code: p.channelCode,
        account: maskAccount(p.accountNumber),
        failure_code: p.failureCode ?? null,
        failure_message: p.failureMessage ?? null,
        estimated_arrival_at: p.estimatedArrivalAt ?? null,
        completed_at: p.completedAt ?? null,
      } : null,
      timestamps: { occurred_at: new Date() },
    };

    let event = this.webhooks.create({
      appId: merchant.appId,
      transactionId: null,
      provider: Provider.Xendit,
      eventType: type,
      providerEventId,
      providerPayload: opts.raw ?? {},
      normalizedPayload: normalized,
      deliveryStatus: WebhookDeliveryStatus.Pending,
      attempts: 0,
      maxAttempts: 5,
    });
    try {
      event = await this.webhooks.save(event);
    } catch (err) {
      // Lost a race with an identical callback — the other one delivers.
      this.logger.debug(`Merchant event ${providerEventId} already stored: ${String(err)}`);
      return;
    }
    await this.deliveryQueue.enqueue({ webhookEventId: event.id, transactionId: null });
  }
}
