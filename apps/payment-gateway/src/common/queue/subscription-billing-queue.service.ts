import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bull';
import { SUBSCRIPTION_BILLING_QUEUE } from './queue.module';

export interface SubscriptionBillingJob {
  subscriptionId: string;
  cycleNumber: number;
}

/**
 * Producer: enqueues "charge this subscription's next cycle" jobs. The worker
 * processes them by calling the provider's chargeWithPaymentMethod (Xendit) or
 * doing nothing (Lemon Squeezy bills itself).
 */
@Injectable()
export class SubscriptionBillingQueueService {
  private readonly logger = new Logger(SubscriptionBillingQueueService.name);

  constructor(
    @InjectQueue(SUBSCRIPTION_BILLING_QUEUE) private readonly queue: Queue<SubscriptionBillingJob>,
  ) {}

  /** Schedule the next billing cycle. `delayMs=0` fires immediately. */
  /**
   * `rescheduleKey` is for re-running a cycle that already has a job (a dunning
   * retry, a paused cycle checked again). The jobId must differ: Bull silently
   * ignores an add whose jobId already exists — and the cycle's own job still
   * exists (it's the one running) — so those retries were simply dropped and a
   * failed renewal was never retried (found in sandbox). First-time schedules
   * keep the plain id, so scheduling the same cycle twice stays a no-op.
   */
  async enqueue(job: SubscriptionBillingJob, delayMs = 0, rescheduleKey?: string): Promise<void> {
    const baseId = `sub_${job.subscriptionId}_cycle_${job.cycleNumber}`;
    await this.queue.add(job, {
      delay: delayMs,
      jobId: rescheduleKey ? `${baseId}_${rescheduleKey}` : baseId,
    });
    this.logger.debug(
      `Scheduled billing for sub ${job.subscriptionId} cycle ${job.cycleNumber} in ${delayMs}ms`,
    );
  }

  /** Cancel any scheduled billing for this subscription (used on cancel/pause). */
  async cancel(subscriptionId: string): Promise<number> {
    const jobs = await this.queue.getJobs(['delayed', 'waiting']);
    let removed = 0;
    for (const job of jobs) {
      if (job.data.subscriptionId === subscriptionId) {
        await job.remove();
        removed++;
      }
    }
    return removed;
  }
}
