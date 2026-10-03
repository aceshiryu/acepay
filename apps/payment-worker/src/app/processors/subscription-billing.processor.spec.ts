// Stub the TypeORM entities. The processor only references the entity classes
// as DI tokens for @InjectRepository; the test constructs it directly with
// mocked repositories, so the real (circularly-imported) entity classes never
// need to load — which also avoids a swc-jest temporal-dead-zone on the cycle.
jest.mock('../../../../payment-gateway/src/database/entities', () => ({
  Subscription: class Subscription {},
  Transaction: class Transaction {},
  WebhookEvent: class WebhookEvent {},
}));

import type { Job } from 'bull';
import { RETRY_SCHEDULE_DAYS } from '../../../../payment-gateway/src/common/billing/dunning';
import {
  Provider,
  SubscriptionStatus,
  TransactionStatus,
} from '../../../../payment-gateway/src/common/enums';
import { SubscriptionBillingProcessor } from './subscription-billing.processor';

type AnyRepo = {
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
};

function repo(): AnyRepo {
  return {
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve({ id: x.id ?? 'generated-id', ...x })),
  };
}

// The processor assigns currentPeriodEnd/status/metadata as it works, so the
// fixture's type has to admit them even though the literal below doesn't set
// every one.
type BillableSub = Record<string, unknown> & {
  status: SubscriptionStatus;
  metadata: Record<string, unknown>;
  currentPeriodEnd?: Date;
};

function makeSub(overrides: Record<string, unknown> = {}): BillableSub {
  return {
    id: 'sub-1',
    appId: 'app-1',
    customerId: 'cus-1',
    provider: Provider.Xendit,
    status: SubscriptionStatus.Active,
    metadata: {},
    app: { slug: 'savi' },
    plan: { amount: 49900, currency: 'PHP', name: 'Pro', interval: 'monthly', intervalCount: 1 },
    customer: { xenditPaymentMethodId: 'pm-1', xenditCustomerId: 'xcus-1' },
    ...overrides,
  };
}

function job(data = { subscriptionId: 'sub-1', cycleNumber: 2 }): Job<{ subscriptionId: string; cycleNumber: number }> {
  return { data } as Job<{ subscriptionId: string; cycleNumber: number }>;
}

describe('SubscriptionBillingProcessor', () => {
  let subs: AnyRepo;
  let txs: AnyRepo;
  let webhooks: AnyRepo;
  let xendit: { chargeWithPaymentMethod: jest.Mock };
  let billingQueue: { enqueue: jest.Mock };
  let deliveryQueue: { enqueue: jest.Mock };
  let processor: SubscriptionBillingProcessor;

  beforeEach(() => {
    subs = repo();
    txs = repo();
    webhooks = repo();
    xendit = { chargeWithPaymentMethod: jest.fn() };
    billingQueue = { enqueue: jest.fn() };
    deliveryQueue = { enqueue: jest.fn() };
    processor = new SubscriptionBillingProcessor(
      subs as never,
      txs as never,
      webhooks as never,
      xendit as never,
      billingQueue as never,
      deliveryQueue as never,
    );
  });

  const emittedEvents = () => webhooks.create.mock.calls.map((c) => c[0].eventType);

  it('happy path: charges, records a succeeded tx, advances the period, schedules the next cycle', async () => {
    const sub = makeSub();
    subs.findOne.mockResolvedValue(sub);
    xendit.chargeWithPaymentMethod.mockResolvedValue({ status: 'SUCCEEDED', paymentRequestId: 'pr-1' });

    await processor.handle(job());

    expect(xendit.chargeWithPaymentMethod).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethodId: 'pm-1', amount: 49900, currency: 'PHP' }),
    );
    expect(txs.create).toHaveBeenCalledWith(expect.objectContaining({ status: TransactionStatus.Succeeded }));
    expect(sub.status).toBe(SubscriptionStatus.Active);
    expect(sub.currentPeriodEnd).toBeInstanceOf(Date);
    // next cycle enqueued
    expect(billingQueue.enqueue).toHaveBeenCalledWith(
      { subscriptionId: 'sub-1', cycleNumber: 3 },
      expect.any(Number),
    );
    expect(emittedEvents()).toContain('subscription.payment_succeeded');
  });

  it('first failure: keeps the sub active (grace), stores a dunning attempt, retries the SAME cycle', async () => {
    const sub = makeSub();
    subs.findOne.mockResolvedValue(sub);
    xendit.chargeWithPaymentMethod.mockResolvedValue({ status: 'FAILED', paymentRequestId: 'pr-2' });

    await processor.handle(job());

    expect(txs.create).toHaveBeenCalledWith(expect.objectContaining({ status: TransactionStatus.Failed }));
    expect(sub.status).toBe(SubscriptionStatus.Active); // still in grace window
    expect((sub.metadata as { dunning: { attempts: number } }).dunning.attempts).toBe(1);
    // retry of the same cycle number, with a delay
    expect(billingQueue.enqueue).toHaveBeenCalledWith(
      { subscriptionId: 'sub-1', cycleNumber: 2 },
      expect.any(Number),
    );
    expect(billingQueue.enqueue.mock.calls[0][1]).toBeGreaterThan(0);
    expect(emittedEvents()).toContain('subscription.payment_retrying');
  });

  // The boundary the dunning off-by-one got wrong: a failure that still has a
  // retry slot left must keep the customer Active and re-enqueue, and each
  // configured wait must actually be used. Walked one slot at a time so an
  // off-by-one shows up as a premature past_due.
  it.each(RETRY_SCHEDULE_DAYS.map((days, i): [number, number] => [i + 1, days]))(
    'failure %i of the schedule keeps the sub active and retries %i day(s) out',
    async (attemptNumber, days) => {
      const sub = makeSub({ metadata: { dunning: { attempts: attemptNumber - 1 } } });
      subs.findOne.mockResolvedValue(sub);
      xendit.chargeWithPaymentMethod.mockResolvedValue({ status: 'FAILED', paymentRequestId: 'pr-x' });

      await processor.handle(job());

      expect(sub.status).toBe(SubscriptionStatus.Active);
      expect((sub.metadata as { dunning: { attempts: number } }).dunning.attempts).toBe(attemptNumber);
      expect(billingQueue.enqueue).toHaveBeenCalledWith(
        { subscriptionId: 'sub-1', cycleNumber: 2 },
        days * 24 * 60 * 60 * 1000,
      );
      expect(emittedEvents()).toContain('subscription.payment_retrying');
      expect(emittedEvents()).not.toContain('subscription.payment_failed');
    },
  );

  it('exhausted retries: marks past_due, emits payment_failed, schedules no more cycles', async () => {
    // Every retry slot is already used, so the next failure exhausts the policy.
    // Derived from the schedule so changing it doesn't silently weaken this test.
    const sub = makeSub({ metadata: { dunning: { attempts: RETRY_SCHEDULE_DAYS.length } } });
    subs.findOne.mockResolvedValue(sub);
    xendit.chargeWithPaymentMethod.mockResolvedValue({ status: 'FAILED', paymentRequestId: 'pr-3' });

    await processor.handle(job());

    expect(sub.status).toBe(SubscriptionStatus.PastDue);
    expect(billingQueue.enqueue).not.toHaveBeenCalled();
    expect(emittedEvents()).toContain('subscription.payment_failed');
  });

  it('recovery: a success after prior failures emits payment_recovered and clears the streak', async () => {
    const sub = makeSub({ metadata: { dunning: { attempts: 1 } } });
    subs.findOne.mockResolvedValue(sub);
    xendit.chargeWithPaymentMethod.mockResolvedValue({ status: 'SUCCEEDED', paymentRequestId: 'pr-4' });

    await processor.handle(job());

    expect((sub.metadata as { dunning: { attempts: number } }).dunning.attempts).toBe(0);
    expect(emittedEvents()).toContain('subscription.payment_recovered');
    expect(emittedEvents()).not.toContain('subscription.payment_succeeded');
  });

  it('does NOT double-advance: a PENDING/REQUIRES_ACTION charge neither advances nor fails the sub', async () => {
    const sub = makeSub();
    subs.findOne.mockResolvedValue(sub);
    xendit.chargeWithPaymentMethod.mockResolvedValue({ status: 'PENDING', paymentRequestId: 'pr-5' });

    await processor.handle(job());

    expect(txs.create).toHaveBeenCalledWith(expect.objectContaining({ status: TransactionStatus.Pending }));
    expect(billingQueue.enqueue).not.toHaveBeenCalled();
    expect(sub.status).toBe(SubscriptionStatus.Active);
  });

  it('canceled subscription: records an audit cancel-tx, expires the sub, emits subscription.expired', async () => {
    const sub = makeSub({ status: SubscriptionStatus.Canceled });
    subs.findOne.mockResolvedValue(sub);

    await processor.handle(job());

    expect(xendit.chargeWithPaymentMethod).not.toHaveBeenCalled();
    expect(txs.create).toHaveBeenCalledWith(expect.objectContaining({ status: TransactionStatus.Canceled }));
    expect(sub.status).toBe(SubscriptionStatus.Expired);
    expect(emittedEvents()).toContain('subscription.expired');
  });

  it('missing saved payment method: marks past_due and does not charge', async () => {
    const sub = makeSub({ customer: { xenditPaymentMethodId: null, xenditCustomerId: null } });
    subs.findOne.mockResolvedValue(sub);

    await processor.handle(job());

    expect(xendit.chargeWithPaymentMethod).not.toHaveBeenCalled();
    expect(sub.status).toBe(SubscriptionStatus.PastDue);
  });

  it('non-Xendit provider (Lemon Squeezy bills itself): no charge, no state change', async () => {
    const sub = makeSub({ provider: Provider.Lemonsqueezy });
    subs.findOne.mockResolvedValue(sub);

    await processor.handle(job());

    expect(xendit.chargeWithPaymentMethod).not.toHaveBeenCalled();
    expect(sub.status).toBe(SubscriptionStatus.Active);
  });

  it('paused subscription: does not charge, defers the same cycle for later (C2)', async () => {
    const sub = makeSub({ status: SubscriptionStatus.Paused });
    subs.findOne.mockResolvedValue(sub);

    await processor.handle(job());

    expect(xendit.chargeWithPaymentMethod).not.toHaveBeenCalled();
    // same cycle re-enqueued with a positive delay; status unchanged
    expect(billingQueue.enqueue).toHaveBeenCalledWith(
      { subscriptionId: 'sub-1', cycleNumber: 2 },
      expect.any(Number),
    );
    expect(billingQueue.enqueue.mock.calls[0][1]).toBeGreaterThan(0);
    expect(sub.status).toBe(SubscriptionStatus.Paused);
  });

  it('missing subscription: drops the job quietly', async () => {
    subs.findOne.mockResolvedValue(null);
    await expect(processor.handle(job())).resolves.toBeUndefined();
    expect(xendit.chargeWithPaymentMethod).not.toHaveBeenCalled();
  });

  it('charge throws: rethrows so Bull can retry per queue policy', async () => {
    const sub = makeSub();
    subs.findOne.mockResolvedValue(sub);
    xendit.chargeWithPaymentMethod.mockRejectedValue(new Error('network blip'));
    await expect(processor.handle(job())).rejects.toThrow(/network blip/);
  });
});
