// Stub the entities: only DI tokens here, and the real ones import in a cycle.
jest.mock('../../../../payment-gateway/src/database/entities', () => ({}));
jest.mock('../../../../payment-gateway/src/modules/marketplace/merchants.service', () => ({ MerchantsService: class {} }));
jest.mock('../../../../payment-gateway/src/common/services/payment-reconciler.service', () => ({ PaymentReconcilerService: class {} }));

import type { Job } from 'bull';
import { ReconcileStaleProcessor } from './reconcile-stale.processor';

function build(sweep: () => Promise<{ checked: number; activated: number }>) {
  const reconciler = { reconcileStale: jest.fn().mockResolvedValue([]) };
  const merchants = { activatePending: jest.fn(sweep) };
  const processor = new ReconcileStaleProcessor({ add: jest.fn() } as never, reconciler as never, merchants as never);
  return { processor, reconciler, merchants };
}

describe('ReconcileStaleProcessor', () => {
  it('rescues stale transactions, then activates pending sub-accounts', async () => {
    const { processor, reconciler, merchants } = build(async () => ({ checked: 2, activated: 1 }));
    await processor.tick({} as Job);
    expect(reconciler.reconcileStale).toHaveBeenCalled();
    expect(merchants.activatePending).toHaveBeenCalled();
  });

  it('a failing sweep never fails the tick', async () => {
    const { processor } = build(async () => {
      throw new Error('Xendit down');
    });
    await expect(processor.tick({} as Job)).resolves.toBeUndefined();
  });
});
