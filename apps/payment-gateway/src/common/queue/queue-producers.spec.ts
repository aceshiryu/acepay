import type { Job, Queue } from 'bull';
import {
  SubscriptionBillingJob,
  SubscriptionBillingQueueService,
} from './subscription-billing-queue.service';
import { WebhookDeliveryQueueService } from './webhook-delivery-queue.service';

describe('WebhookDeliveryQueueService', () => {
  let queue: { add: jest.Mock; getJob: jest.Mock };
  let service: WebhookDeliveryQueueService;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined), getJob: jest.fn().mockResolvedValue(null) };
    service = new WebhookDeliveryQueueService(queue as unknown as Queue);
  });

  it('enqueues the job payload as given', async () => {
    await service.enqueue({ webhookEventId: 'evt-1', transactionId: 'tx-1' });
    expect(queue.add).toHaveBeenCalledWith(
      { webhookEventId: 'evt-1', transactionId: 'tx-1' },
      expect.objectContaining({ jobId: 'wh_evt-1' }),
    );
  });

  // The job id IS the dedup key — two enqueues for one event must collapse to a
  // single delivery, which is what keeps a retry storm from double-notifying an app.
  it('derives the job id from the event id so re-enqueues dedupe', async () => {
    await service.enqueue({ webhookEventId: 'evt-9', transactionId: null });
    await service.enqueue({ webhookEventId: 'evt-9', transactionId: null });
    const ids = queue.add.mock.calls.map((c) => c[1].jobId);
    expect(ids).toEqual(['wh_evt-9', 'wh_evt-9']);
  });

  it('accepts a job with no transaction attached', async () => {
    await service.enqueue({ webhookEventId: 'evt-2', transactionId: null });
    expect(queue.add.mock.calls[0][0].transactionId).toBeNull();
  });

  // Bull ignores an add whose jobId already exists. Since the job id IS the
  // event id, an operator retry of an already-attempted event would enqueue
  // nothing and park the event in `pending` with no delivery behind it.
  describe('operator retry', () => {
    it('drops the stale job before re-adding, so the retry actually runs', async () => {
      const remove = jest.fn().mockResolvedValue(undefined);
      queue.getJob.mockResolvedValue({ remove });
      await service.enqueue({ webhookEventId: 'evt-1', transactionId: null }, { replaceExisting: true });
      expect(queue.getJob).toHaveBeenCalledWith('wh_evt-1');
      expect(remove).toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledWith(
        { webhookEventId: 'evt-1', transactionId: null },
        expect.objectContaining({ jobId: 'wh_evt-1' }),
      );
    });

    it('still enqueues when there is no stale job to drop', async () => {
      queue.getJob.mockResolvedValue(null);
      await service.enqueue({ webhookEventId: 'evt-2', transactionId: null }, { replaceExisting: true });
      expect(queue.add).toHaveBeenCalled();
    });

    it('leaves the dedup intact for normal traffic', async () => {
      await service.enqueue({ webhookEventId: 'evt-3', transactionId: null });
      expect(queue.getJob).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalled();
    });
  });

  it('propagates a queue failure instead of silently dropping the delivery', async () => {
    queue.add.mockRejectedValue(new Error('redis unreachable'));
    await expect(service.enqueue({ webhookEventId: 'evt-3', transactionId: null }))
      .rejects.toThrow('redis unreachable');
  });
});

describe('SubscriptionBillingQueueService', () => {
  let queue: { add: jest.Mock; getJobs: jest.Mock };
  let service: SubscriptionBillingQueueService;

  function job(subscriptionId: string, remove = jest.fn().mockResolvedValue(undefined)) {
    return { data: { subscriptionId, cycleNumber: 2 }, remove } as unknown as
      Job<SubscriptionBillingJob> & { remove: jest.Mock };
  }

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined), getJobs: jest.fn().mockResolvedValue([]) };
    service = new SubscriptionBillingQueueService(queue as unknown as Queue<SubscriptionBillingJob>);
  });

  describe('enqueue', () => {
    it('schedules a cycle with the requested delay', async () => {
      await service.enqueue({ subscriptionId: 'sub-1', cycleNumber: 3 }, 86_400_000);
      expect(queue.add).toHaveBeenCalledWith(
        { subscriptionId: 'sub-1', cycleNumber: 3 },
        { delay: 86_400_000, jobId: 'sub_sub-1_cycle_3' },
      );
    });

    it('fires immediately when no delay is given', async () => {
      await service.enqueue({ subscriptionId: 'sub-1', cycleNumber: 1 });
      expect(queue.add.mock.calls[0][1].delay).toBe(0);
    });

    // Keying on sub + cycle is what stops a double-charge: two enqueues for the
    // same cycle are one job, while different cycles stay distinct.
    it('keys the job id on both subscription and cycle', async () => {
      await service.enqueue({ subscriptionId: 'sub-1', cycleNumber: 2 });
      await service.enqueue({ subscriptionId: 'sub-1', cycleNumber: 2 });
      await service.enqueue({ subscriptionId: 'sub-1', cycleNumber: 3 });
      await service.enqueue({ subscriptionId: 'sub-2', cycleNumber: 2 });
      expect(queue.add.mock.calls.map((c) => c[1].jobId)).toEqual([
        'sub_sub-1_cycle_2',
        'sub_sub-1_cycle_2',
        'sub_sub-1_cycle_3',
        'sub_sub-2_cycle_2',
      ]);
    });
  });

  describe('cancel', () => {
    it('only looks at jobs that have not run yet', async () => {
      await service.cancel('sub-1');
      expect(queue.getJobs).toHaveBeenCalledWith(['delayed', 'waiting']);
    });

    it('removes every queued cycle for the subscription and counts them', async () => {
      const a = job('sub-1');
      const b = job('sub-1');
      queue.getJobs.mockResolvedValue([a, b]);
      await expect(service.cancel('sub-1')).resolves.toBe(2);
      expect(a.remove).toHaveBeenCalled();
      expect(b.remove).toHaveBeenCalled();
    });

    it('leaves other subscriptions alone', async () => {
      const mine = job('sub-1');
      const theirs = job('sub-2');
      queue.getJobs.mockResolvedValue([mine, theirs]);
      await expect(service.cancel('sub-1')).resolves.toBe(1);
      expect(mine.remove).toHaveBeenCalled();
      expect(theirs.remove).not.toHaveBeenCalled();
    });

    it('reports zero when nothing is queued', async () => {
      queue.getJobs.mockResolvedValue([]);
      await expect(service.cancel('sub-1')).resolves.toBe(0);
    });

    it('reports zero when no queued job belongs to the subscription', async () => {
      queue.getJobs.mockResolvedValue([job('sub-2'), job('sub-3')]);
      await expect(service.cancel('sub-1')).resolves.toBe(0);
    });
  });
});
