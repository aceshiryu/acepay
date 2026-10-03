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

  /**
   * `replaceExisting` is for an operator-initiated retry. Bull silently ignores
   * an add whose jobId already exists, and the job id is the event id — so
   * retrying an event that has already been attempted would enqueue nothing,
   * leaving it parked in `pending` forever with no delivery. Dropping the old
   * job first makes the retry real while keeping the dedup for normal traffic.
   */
  async enqueue(job: WebhookDeliveryJob, opts: { replaceExisting?: boolean } = {}): Promise<void> {
    const jobId = `wh_${job.webhookEventId}`;
    if (opts.replaceExisting) {
      const existing = await this.queue.getJob(jobId);
      if (existing) await existing.remove();
    }
    await this.queue.add(job, {
      // Use the event id as the job id so re-enqueues for the same event get deduplicated.
      jobId,
    });
    this.logger.debug(`Enqueued webhook delivery for event ${job.webhookEventId}`);
  }
}
