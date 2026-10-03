import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bull';
import { PAYOUT_RUNS_QUEUE } from './queue.module';

export interface PayoutRunJob {
  /** build = read every merchant's balance into a draft preview;
   *  execute = send the run's queued payouts to Xendit. */
  type: 'build' | 'execute';
  runId: string;
}

/** Producer for the payout-runs queue. The worker's PayoutRunProcessor drains it. */
@Injectable()
export class PayoutRunQueueService {
  constructor(@InjectQueue(PAYOUT_RUNS_QUEUE) private readonly queue: Queue<PayoutRunJob>) {}

  async enqueue(job: PayoutRunJob): Promise<void> {
    // A unique job id per (type, run, request) — execute can legitimately be
    // enqueued again for the same run by "retry failed".
    await this.queue.add(job, { jobId: `payout_${job.type}_${job.runId}_${Date.now()}` });
  }
}
