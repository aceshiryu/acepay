import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Job } from 'bull';
import { Repository } from 'typeorm';
import { WEBHOOK_DELIVERY_QUEUE } from '../../../../payment-gateway/src/common/queue/queue.module';
import { WebhookDeliveryJob } from '../../../../payment-gateway/src/common/queue/webhook-delivery-queue.service';
import { WebhookDeliveryService } from '../../../../payment-gateway/src/common/services/webhook-delivery.service';
import { App, Transaction, WebhookEvent } from '../../../../payment-gateway/src/database/entities';

/**
 * Drains the webhook-delivery queue. For each job:
 *  - loads the WebhookEvent + its App (+ Transaction if present)
 *  - calls WebhookDeliveryService.deliver(), which POSTs the signed payload
 *  - lets Bull's retry policy handle non-2xx and timeouts (5 attempts, exp backoff)
 *
 * If the delivery throws, this method throws — Bull then schedules a retry per the
 * queue's defaultJobOptions in queue.module.ts.
 */
@Processor(WEBHOOK_DELIVERY_QUEUE)
export class WebhookDeliveryProcessor {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(
    @InjectRepository(WebhookEvent) private readonly events: Repository<WebhookEvent>,
    @InjectRepository(App) private readonly apps: Repository<App>,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    private readonly delivery: WebhookDeliveryService,
  ) {}

  @Process()
  async handle(job: Job<WebhookDeliveryJob>): Promise<void> {
    const { webhookEventId, transactionId } = job.data;
    const event = await this.events.findOne({ where: { id: webhookEventId } });
    if (!event) {
      this.logger.warn(`Webhook event ${webhookEventId} no longer exists — dropping job`);
      return;
    }
    const app = await this.apps.findOne({ where: { id: event.appId } });
    if (!app) {
      this.logger.warn(`App ${event.appId} no longer exists — dropping job ${webhookEventId}`);
      return;
    }
    const tx = transactionId
      ? await this.transactions.findOne({ where: { id: transactionId } })
      : null;

    this.logger.debug(`Delivering webhook ${event.id} → ${app.webhookUrl ?? '(no url)'} (attempt ${job.attemptsMade + 1})`);
    await this.delivery.deliver(app, event, tx);

    // If the delivery still isn't in the success state, throw so Bull retries.
    const refreshed = await this.events.findOne({ where: { id: webhookEventId } });
    if (refreshed && refreshed.deliveryStatus !== 'delivered') {
      throw new Error(`Delivery for ${webhookEventId} did not succeed (status=${refreshed.deliveryStatus})`);
    }
  }
}
