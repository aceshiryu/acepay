import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Logger, OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bull';
import { RECONCILE_STALE_QUEUE } from '../../../../payment-gateway/src/common/queue/queue.module';
import { PaymentReconcilerService } from '../../../../payment-gateway/src/common/services/payment-reconciler.service';
import { MerchantsService } from '../../../../payment-gateway/src/modules/marketplace/merchants.service';

const REPEAT_EVERY_MS = 15 * 60 * 1000; // every 15 minutes
const STALE_AFTER_SECONDS = 5 * 60;     // tx pending > 5 minutes
const RECONCILE_LIMIT = 50;

/**
 * Periodically scans for pending transactions older than 5 minutes and
 * reconciles them against the provider (rescue for missed webhooks), and
 * activates sub-accounts Xendit already made LIVE whose account callback never
 * arrived. Schedules itself as a Bull repeatable job on module init.
 */
@Processor(RECONCILE_STALE_QUEUE)
export class ReconcileStaleProcessor implements OnModuleInit {
  private readonly logger = new Logger(ReconcileStaleProcessor.name);

  constructor(
    @InjectQueue(RECONCILE_STALE_QUEUE) private readonly queue: Queue,
    private readonly reconciler: PaymentReconcilerService,
    private readonly merchants: MerchantsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Schedule the repeating tick. Bull dedupes via jobId, so restarting the
    // worker doesn't create duplicate schedules.
    await this.queue.add(
      {},
      {
        repeat: { every: REPEAT_EVERY_MS },
        jobId: 'reconcile-stale-tick',
      },
    );
    this.logger.log(`Reconcile-stale scheduled every ${REPEAT_EVERY_MS / 1000}s`);
  }

  @Process()
  async tick(_job: Job): Promise<void> {
    const results = await this.reconciler.reconcileStale(STALE_AFTER_SECONDS, RECONCILE_LIMIT);
    const changed = results.filter((r) => r.changed).length;
    if (changed > 0) {
      this.logger.log(`Reconciled ${results.length} stale tx, ${changed} state changes applied`);
    } else if (results.length > 0) {
      this.logger.debug(`Reconciled ${results.length} stale tx, no state changes`);
    }

    // A failure here must not undo the transaction sweep above.
    try {
      const { checked, activated } = await this.merchants.activatePending();
      if (activated > 0) this.logger.log(`Activated ${activated} of ${checked} pending merchant sub-account(s)`);
    } catch (err) {
      this.logger.warn(`Pending-merchant sweep failed: ${String(err)}`);
    }
  }
}
