import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bull';
import { WEBHOOK_DELIVERY_QUEUE } from './queue.module';

export interface WebhookDeliveryJob {
  webhookEventId: string;
  transactionId: string | null;
}

/**
 * Producer: enqueues outbound webhook deliveries. The actual HTTP POST + retry
 * logic is implemented in the payment-worker as a Bull processor that drains
 * this queue. Gateway code calls `enqueue()` and returns immediately.
 */
@Injectable()
export class WebhookDeliveryQueueService {
  private readonly logger = new Logger(WebhookDeliveryQueueService.name);

  constructor(
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE) private readonly queue: Queue<WebhookDeliveryJob>,
  ) {}

  async enqueue(job: WebhookDeliveryJob): Promise<void> {
    await this.queue.add(job, {
      // Use the event id as the job id so re-enqueues for the same event get deduplicated.
      jobId: `wh_${job.webhookEventId}`,
    });
    this.logger.debug(`Enqueued webhook delivery for event ${job.webhookEventId}`);
  }
}
