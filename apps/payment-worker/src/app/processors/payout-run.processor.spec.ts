jest.mock('../../../../payment-gateway/src/modules/marketplace/payout-runs.service', () => ({
  PayoutRunsService: class PayoutRunsService {},
}));

import type { Job } from 'bull';
import { PayoutRunJob } from '../../../../payment-gateway/src/common/queue/payout-run-queue.service';
import { PayoutRunsService } from '../../../../payment-gateway/src/modules/marketplace/payout-runs.service';
import { PayoutRunProcessor } from './payout-run.processor';

function job(data: PayoutRunJob, attemptsMade = 0, attempts = 3): Job<PayoutRunJob> {
  return { data, attemptsMade, opts: { attempts } } as unknown as Job<PayoutRunJob>;
}

describe('PayoutRunProcessor', () => {
  let runs: { build: jest.Mock; execute: jest.Mock };
  let processor: PayoutRunProcessor;

  beforeEach(() => {
    runs = { build: jest.fn().mockResolvedValue(undefined), execute: jest.fn().mockResolvedValue(undefined) };
    processor = new PayoutRunProcessor(runs as unknown as PayoutRunsService);
  });

  it('builds the preview for a build job', async () => {
    await processor.handle(job({ type: 'build', runId: 'run-1' }));
    expect(runs.build).toHaveBeenCalledWith('run-1');
    expect(runs.execute).not.toHaveBeenCalled();
  });

  it.each([
    [0, 3, false],
    [1, 3, false],
    [2, 3, true],
    [0, 1, true],
  ])('execute on attempt %i of %i → lastAttempt=%s', async (made, attempts, last) => {
    await processor.handle(job({ type: 'execute', runId: 'run-1' }, made, attempts));
    expect(runs.execute).toHaveBeenCalledWith('run-1', { lastAttempt: last });
  });

  it('lets an execute error propagate so Bull retries', async () => {
    runs.execute.mockRejectedValue(new Error('2 payout(s) hit transport errors; retrying'));
    await expect(processor.handle(job({ type: 'execute', runId: 'run-1' }))).rejects.toThrow(/retrying/);
  });
});
