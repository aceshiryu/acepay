import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PAYOUT_RUNS_QUEUE } from '../../../../payment-gateway/src/common/queue/queue.module';
import { PayoutRunJob } from '../../../../payment-gateway/src/common/queue/payout-run-queue.service';
import { PayoutRunsService } from '../../../../payment-gateway/src/modules/marketplace/payout-runs.service';

/**
 * Drains the payout-runs queue (Slice 6). Runs are only ever started and
 * confirmed by an operator in the admin — this processor does the slow parts:
 *  - build:   read every merchant's live sub-account balance into a preview
 *  - execute: send the confirmed payouts to Xendit, one by one
 */
@Processor(PAYOUT_RUNS_QUEUE)
export class PayoutRunProcessor {
  private readonly logger = new Logger(PayoutRunProcessor.name);

  constructor(private readonly runs: PayoutRunsService) {}

  @Process()
  async handle(job: Job<PayoutRunJob>): Promise<void> {
    const { type, runId } = job.data;
    this.logger.log(`Payout run ${runId}: ${type} (attempt ${job.attemptsMade + 1})`);
    if (type === 'build') {
      await this.runs.build(runId);
      return;
    }
    const maxAttempts = job.opts.attempts ?? 1;
    await this.runs.execute(runId, { lastAttempt: job.attemptsMade + 1 >= maxAttempts });
  }
}
