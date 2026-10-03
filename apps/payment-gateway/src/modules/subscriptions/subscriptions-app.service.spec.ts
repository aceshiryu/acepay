// The entity barrel has a circular import (App → Customer → Subscription →
// Plan → App) that swc-jest turns into a temporal-dead-zone error at load.
jest.mock('../../database/entities', () => ({
  App: class App {},
  Customer: class Customer {},
  Plan: class Plan {},
  Subscription: class Subscription {},
  Transaction: class Transaction {},
  TransactionLog: class TransactionLog {},
  User: class User {},
  WebhookEvent: class WebhookEvent {},
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BillingMode, Provider, SubscriptionStatus } from '../../common/enums';
import { App, Customer, Subscription } from '../../database/entities';
import { ProviderRegistry } from '../../payment-providers/provider.registry';
import { MetadataValidatorService } from '../../common/services/metadata-validator.service';
import { CustomersAppService } from '../customers/customers-app.service';
import { PlansService } from '../plans/plans.service';
import { SubscriptionsAppService } from './subscriptions-app.service';

const CALLER = {
  id: 'app-1', slug: 'savi', name: 'Savi', billingMode: BillingMode.Subscription,
} as App;

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    provider: Provider.Xendit,
    providerPlanId: 'variant-1',
    amount: 49900,
    currency: 'PHP',
    interval: 'monthly',
    intervalCount: 1,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function customer(overrides: Partial<Customer> = {}): Customer {
  return { id: 'cus-1', appId: 'app-1', email: 'buyer@example.com', name: 'Buyer', ...overrides } as Customer;
}

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    appId: 'app-1',
    customerId: 'cus-1',
    planId: 'plan-1',
    provider: Provider.Xendit,
    providerSubscriptionId: 'prov-sub-1',
    status: SubscriptionStatus.Active,
    metadata: {},
    ...overrides,
  } as Subscription;
}

const DTO = {
  planId: 'plan-1',
  customerId: 'cus-1',
  redirect: { success: 'https://savi.app/ok', failed: 'https://savi.app/no' },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('SubscriptionsAppService (/v1/subscriptions)', () => {
  let subscriptions: {
    findOne: jest.Mock; create: jest.Mock; save: jest.Mock; createQueryBuilder: jest.Mock;
  };
  let customers: { findOne: jest.Mock };
  let qb: Record<string, jest.Mock>;
  let plans: { findActiveForApp: jest.Mock };
  let adapter: Record<string, jest.Mock>;
  let providers: { resolve: jest.Mock };
  let customersApp: { upsert: jest.Mock };
  let metadataValidator: MetadataValidatorService;
  let service: SubscriptionsAppService;

  beforeEach(() => {
    qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    subscriptions = {
      findOne: jest.fn(),
      create: jest.fn((s) => s),
      save: jest.fn((s) => Promise.resolve(s)),
      createQueryBuilder: jest.fn(() => qb),
    };
    customers = { findOne: jest.fn().mockResolvedValue(customer()) };
    plans = { findActiveForApp: jest.fn().mockResolvedValue(plan()) };
    adapter = {
      createSubscription: jest.fn().mockResolvedValue({
        providerCheckoutId: 'chk-1', checkoutUrl: 'https://pay/chk-1',
      }),
      cancelSubscription: jest.fn().mockResolvedValue({
        status: SubscriptionStatus.Canceled, cancelAt: new Date('2026-02-01T00:00:00Z'), canceledAt: null,
      }),
      uncancelSubscription: jest.fn().mockResolvedValue({ status: SubscriptionStatus.Active }),
      pauseSubscription: jest.fn().mockResolvedValue({ status: SubscriptionStatus.Paused }),
      resumeSubscription: jest.fn().mockResolvedValue({ status: SubscriptionStatus.Active }),
    };
    providers = { resolve: jest.fn().mockReturnValue(adapter) };
    customersApp = { upsert: jest.fn().mockResolvedValue(customer({ id: 'cus-new' })) };
    // The real validator — it is pure, and using it keeps this spec honest about
    // the app's required-metadata contract actually being enforced.
    metadataValidator = new MetadataValidatorService();
    service = new SubscriptionsAppService(
      subscriptions as unknown as Repository<Subscription>,
      customers as unknown as Repository<Customer>,
      plans as unknown as PlansService,
      providers as unknown as ProviderRegistry,
      customersApp as unknown as CustomersAppService,
      metadataValidator,
    );
  });

  describe('create', () => {
    // A client that times out cannot tell whether the request landed. Without a
    // retry key it retries and the customer ends up with two subscriptions and
    // two competing checkout URLs.
    describe('idempotency', () => {
      it('replays the original subscription instead of creating a second one', async () => {
        const first = sub({ metadata: { checkoutUrl: 'https://pay/original' } });
        subscriptions.findOne.mockResolvedValue(first);
        const res = await service.create(CALLER, { ...DTO, idempotencyKey: 'retry-1' });
        expect(res.subscription).toBe(first);
        expect(res.checkoutUrl).toBe('https://pay/original');
        expect(adapter.createSubscription).not.toHaveBeenCalled();
        expect(subscriptions.save).not.toHaveBeenCalled();
      });

      it('scopes the retry key to the calling app', async () => {
        subscriptions.findOne.mockResolvedValue(null);
        await service.create(CALLER, { ...DTO, idempotencyKey: 'retry-1' });
        expect(subscriptions.findOne).toHaveBeenCalledWith({
          where: { appId: 'app-1', idempotencyKey: 'retry-1' },
        });
      });

      it('stores the key on the new subscription', async () => {
        subscriptions.findOne.mockResolvedValue(null);
        await service.create(CALLER, { ...DTO, idempotencyKey: 'retry-1' });
        expect(subscriptions.create.mock.calls[0][0].idempotencyKey).toBe('retry-1');
      });

      it('creates normally when no key is given, and stores null', async () => {
        await service.create(CALLER, DTO);
        expect(subscriptions.findOne).not.toHaveBeenCalled();
        expect(adapter.createSubscription).toHaveBeenCalled();
        expect(subscriptions.create.mock.calls[0][0].idempotencyKey).toBeNull();
      });

      // Found live: two concurrent creates with the same key raced past the read,
      // the unique index stopped the duplicate, and the loser got a raw Postgres
      // constraint violation as a 500 instead of the subscription it asked for.
      it('replays the winner when two requests race past the read', async () => {
        const winner = sub({ metadata: { checkoutUrl: 'https://pay/winner' } });
        subscriptions.findOne
          .mockResolvedValueOnce(null)      // the pre-check finds nothing
          .mockResolvedValueOnce(winner);   // the post-violation read finds the winner
        const violation = Object.assign(new Error('duplicate key'), { code: '23505' });
        subscriptions.save.mockRejectedValueOnce(violation);

        const res = await service.create(CALLER, { ...DTO, idempotencyKey: 'race-1' });
        expect(res.subscription).toBe(winner);
        expect(res.checkoutUrl).toBe('https://pay/winner');
      });

      it('recognises the violation when the driver nests the code', async () => {
        const winner = sub({ metadata: {} });
        subscriptions.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
        subscriptions.save.mockRejectedValueOnce(
          Object.assign(new Error('duplicate key'), { driverError: { code: '23505' } }),
        );
        await expect(service.create(CALLER, { ...DTO, idempotencyKey: 'race-2' }))
          .resolves.toMatchObject({ subscription: winner });
      });

      it('rethrows a save failure that is not a uniqueness violation', async () => {
        subscriptions.findOne.mockResolvedValue(null);
        subscriptions.save.mockRejectedValueOnce(
          Object.assign(new Error('connection terminated'), { code: '08006' }),
        );
        await expect(service.create(CALLER, { ...DTO, idempotencyKey: 'race-3' }))
          .rejects.toThrow('connection terminated');
      });

      it('rethrows when the violation leaves nothing to replay', async () => {
        subscriptions.findOne.mockResolvedValue(null);
        subscriptions.save.mockRejectedValueOnce(
          Object.assign(new Error('duplicate key'), { code: '23505' }),
        );
        await expect(service.create(CALLER, { ...DTO, idempotencyKey: 'race-4' }))
          .rejects.toThrow('duplicate key');
      });

      it('checks the key before doing any work, so a retry costs nothing', async () => {
        subscriptions.findOne.mockResolvedValue(sub({ metadata: {} }));
        await service.create(CALLER, { ...DTO, idempotencyKey: 'retry-1' });
        expect(plans.findActiveForApp).not.toHaveBeenCalled();
        expect(customersApp.upsert).not.toHaveBeenCalled();
      });
    });

    it('refuses an app that is not in subscription billing mode', async () => {
      const oneTime = { ...CALLER, billingMode: BillingMode.OneTime } as App;
      await expect(service.create(oneTime, DTO)).rejects.toThrow(/one-time-payment only/);
      expect(plans.findActiveForApp).not.toHaveBeenCalled();
    });

    it('resolves the plan scoped to the calling app', async () => {
      await service.create(CALLER, DTO);
      expect(plans.findActiveForApp).toHaveBeenCalledWith('plan-1', 'app-1');
    });

    describe('customer resolution', () => {
      it('looks an existing customerId up within the calling app only', async () => {
        await service.create(CALLER, DTO);
        expect(customers.findOne).toHaveBeenCalledWith({
          where: { id: 'cus-1', appId: 'app-1' },
        });
      });

      it('404s when the customer belongs to another app', async () => {
        customers.findOne.mockResolvedValue(null);
        await expect(service.create(CALLER, DTO)).rejects.toBeInstanceOf(NotFoundException);
        expect(adapter.createSubscription).not.toHaveBeenCalled();
      });

      it('upserts an inline customer so the app can skip POST /v1/customers', async () => {
        const inline = { email: 'new@example.com', externalId: 'u-9' };
        await service.create(CALLER, { ...DTO, customerId: undefined, customer: inline });
        expect(customersApp.upsert).toHaveBeenCalledWith(CALLER, inline);
        expect(subscriptions.create.mock.calls[0][0].customerId).toBe('cus-new');
      });

      it('prefers an explicit customerId over inline details', async () => {
        await service.create(CALLER, { ...DTO, customer: { email: 'x@y.z', externalId: 'u-9' } });
        expect(customersApp.upsert).not.toHaveBeenCalled();
      });

      it('requires one of customerId or inline customer', async () => {
        try {
          await service.create(CALLER, { ...DTO, customerId: undefined, customer: undefined });
          throw new Error('expected a throw');
        } catch (e) {
          expect(e).toBeInstanceOf(BadRequestException);
          expect((e as BadRequestException).getResponse()).toMatchObject({
            error: 'customer_required',
          });
        }
      });
    });

    // app.requiredMetadata is documented as "missing keys are rejected". It was
    // only wired to the deleted POST /v1/payments, so it silently enforced
    // nothing until this was reconnected — a UAT finding, not a unit-test one.
    describe("the app's required-metadata contract", () => {
      const strict = { ...CALLER, requiredMetadata: ['user_id'] } as App;

      it.each([
        ['metadata is absent entirely', undefined],
        ['metadata is an empty object', {}],
        ['the required key is an empty string', { user_id: '' }],
        ['the required key is null', { user_id: null }],
      ])('rejects a subscription when %s', async (_label, metadata) => {
        await expect(service.create(strict, { ...DTO, metadata }))
          .rejects.toThrow(/requires: user_id/);
        expect(adapter.createSubscription).not.toHaveBeenCalled();
        expect(subscriptions.save).not.toHaveBeenCalled();
      });

      it('names every missing key', async () => {
        const twoKeys = { ...CALLER, requiredMetadata: ['user_id', 'plan_code'] } as App;
        try {
          await service.create(twoKeys, { ...DTO, metadata: { plan_code: 'x' } });
          throw new Error('expected a throw');
        } catch (e) {
          expect((e as BadRequestException).getResponse()).toMatchObject({
            error: 'missing_required_metadata', missing: ['user_id'],
          });
        }
      });

      it('accepts a legitimate falsy value such as 0', async () => {
        await expect(service.create(strict, { ...DTO, metadata: { user_id: 0 } }))
          .resolves.toBeDefined();
      });

      it('rejects before the customer is touched, so nothing is half-created', async () => {
        await expect(service.create(strict, { ...DTO, customerId: undefined, customer: { email: 'a@b.c', externalId: 'u' }, metadata: {} }))
          .rejects.toThrow(/requires: user_id/);
        expect(customersApp.upsert).not.toHaveBeenCalled();
      });

      it('is a no-op for an app that requires nothing', async () => {
        await expect(service.create(CALLER, { ...DTO, metadata: undefined })).resolves.toBeDefined();
      });
    });

    // Xendit has no Plan resource, so the adapter needs the price inline or it
    // cannot build the first-cycle invoice.
    it('passes the plan price and cadence to the adapter', async () => {
      await service.create(CALLER, DTO);
      expect(adapter.createSubscription).toHaveBeenCalledWith(expect.objectContaining({
        appSlug: 'savi',
        providerPlanId: 'variant-1',
        metadata: expect.objectContaining({
          plan_amount: 49900,
          plan_currency: 'PHP',
          plan_interval: 'monthly',
          plan_interval_count: 1,
        }),
        customer: { email: 'buyer@example.com', name: 'Buyer' },
      }));
    });

    it('routes to the adapter named by the plan', async () => {
      plans.findActiveForApp.mockResolvedValue(plan({ provider: Provider.Lemonsqueezy }));
      await service.create(CALLER, DTO);
      expect(providers.resolve).toHaveBeenCalledWith(Provider.Lemonsqueezy);
    });

    it('uses one generated id for both the adapter call and the saved row', async () => {
      await service.create(CALLER, DTO);
      const sentId = adapter.createSubscription.mock.calls[0][0].acepaySubscriptionId;
      expect(subscriptions.create.mock.calls[0][0].id).toBe(sentId);
      expect(sentId).toMatch(/^[0-9a-f-]{36}$/);
    });

    // The row is only written AFTER the provider accepts, so a provider failure
    // cannot leave a dangling subscription the app would see as real.
    it('does not persist a subscription when the provider rejects it', async () => {
      adapter.createSubscription.mockRejectedValue(new Error('variant not found'));
      try {
        await service.create(CALLER, DTO);
        throw new Error('expected a throw');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).getResponse()).toEqual({
          error: 'provider_create_failed',
          message: 'variant not found',
        });
      }
      expect(subscriptions.save).not.toHaveBeenCalled();
    });

    it('wraps a non-Error provider rejection', async () => {
      adapter.createSubscription.mockRejectedValue('upstream exploded');
      await expect(service.create(CALLER, DTO)).rejects.toThrow('upstream exploded');
    });

    it('parks the row in the awaiting-first-payment state', async () => {
      await service.create(CALLER, DTO);
      expect(subscriptions.create).toHaveBeenCalledWith(expect.objectContaining({
        appId: 'app-1',
        customerId: 'cus-1',
        planId: 'plan-1',
        provider: Provider.Xendit,
        // Until the provider webhook lands this is the CHECKOUT id, not the
        // real subscription id.
        providerSubscriptionId: 'chk-1',
        status: SubscriptionStatus.Active,
        metadata: expect.objectContaining({ awaitingFirstPayment: true, checkoutUrl: 'https://pay/chk-1' }),
      }));
    });

    it('keeps the caller metadata alongside the internal flags', async () => {
      await service.create(CALLER, { ...DTO, metadata: { tier: 'pro' } });
      expect(subscriptions.create.mock.calls[0][0].metadata).toMatchObject({
        tier: 'pro', awaitingFirstPayment: true,
      });
    });

    it('returns the saved subscription with its checkout URL', async () => {
      const res = await service.create(CALLER, DTO);
      expect(res.checkoutUrl).toBe('https://pay/chk-1');
      expect(res.subscription).toBeDefined();
    });
  });

  describe('tenant isolation', () => {
    it('scopes findOne to the calling app and hydrates plan + customer', async () => {
      subscriptions.findOne.mockResolvedValue(sub());
      await service.findOne(CALLER, 'sub-1');
      expect(subscriptions.findOne).toHaveBeenCalledWith({
        where: { id: 'sub-1', appId: 'app-1' },
        relations: { plan: true, customer: true },
      });
    });

    it('reports another app’s subscription as not found', async () => {
      subscriptions.findOne.mockResolvedValue(null);
      await expect(service.findOne(CALLER, 'sub-of-other-app'))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      ['cancel', () => service.cancel(CALLER, 'sub-1', {})],
      ['reactivate', () => service.reactivate(CALLER, 'sub-1')],
      ['pause', () => service.pause(CALLER, 'sub-1')],
      ['resume', () => service.resume(CALLER, 'sub-1')],
    ])('%s cannot act on a subscription outside the calling app', async (_label, call) => {
      subscriptions.findOne.mockResolvedValue(null);
      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
      expect(providers.resolve).not.toHaveBeenCalled();
    });

    it('list filters by the calling app', async () => {
      await service.list(CALLER, {});
      expect(qb.where).toHaveBeenCalledWith('sub.app_id = :appId', { appId: 'app-1' });
    });
  });

  describe('list', () => {
    it('applies the documented filters', async () => {
      await service.list(CALLER, {
        customerId: 'cus-1', provider: Provider.Xendit, status: SubscriptionStatus.Active,
      });
      expect(qb.andWhere.mock.calls.map((c) => c[0])).toEqual([
        'sub.customer_id = :customerId',
        'sub.provider = :provider',
        'sub.status = :status',
      ]);
    });

    it('orders by the entity property, never the snake_case column', async () => {
      await service.list(CALLER, {});
      expect(qb.orderBy).toHaveBeenCalledWith('sub.createdAt', 'DESC');
    });

    it.each([
      [{}, 0, 20],
      [{ page: 3, pageSize: 10 }, 20, 10],
    ])('paginates %j as skip=%i take=%i', async (q, skip, take) => {
      await service.list(CALLER, q);
      expect(qb.skip).toHaveBeenCalledWith(skip);
      expect(qb.take).toHaveBeenCalledWith(take);
    });
  });

  describe('cancel', () => {
    it('is idempotent for an already-canceled subscription', async () => {
      const s = sub({ status: SubscriptionStatus.Canceled });
      subscriptions.findOne.mockResolvedValue(s);
      await expect(service.cancel(CALLER, 'sub-1', {})).resolves.toBe(s);
      expect(adapter.cancelSubscription).not.toHaveBeenCalled();
      expect(subscriptions.save).not.toHaveBeenCalled();
    });

    it('cancels through the provider and stores the resulting state', async () => {
      const s = sub();
      subscriptions.findOne.mockResolvedValue(s);
      await service.cancel(CALLER, 'sub-1', {});
      expect(adapter.cancelSubscription).toHaveBeenCalledWith('prov-sub-1');
      expect(s.status).toBe(SubscriptionStatus.Canceled);
      expect(s.cancelAt?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    });

    it('stamps canceledAt itself when the provider does not report one', async () => {
      const s = sub();
      subscriptions.findOne.mockResolvedValue(s);
      await service.cancel(CALLER, 'sub-1', {});
      expect(s.canceledAt).toBeInstanceOf(Date);
    });

    it('prefers the provider canceledAt when present', async () => {
      const provided = new Date('2026-03-03T00:00:00Z');
      adapter.cancelSubscription.mockResolvedValue({
        status: SubscriptionStatus.Canceled, cancelAt: null, canceledAt: provided,
      });
      const s = sub();
      subscriptions.findOne.mockResolvedValue(s);
      await service.cancel(CALLER, 'sub-1', {});
      expect(s.canceledAt).toBe(provided);
    });

    it('records a cancel reason without dropping existing metadata', async () => {
      const s = sub({ metadata: { tier: 'pro' } });
      subscriptions.findOne.mockResolvedValue(s);
      await service.cancel(CALLER, 'sub-1', { reason: 'too expensive' });
      expect(s.metadata).toEqual({ tier: 'pro', cancelReason: 'too expensive' });
    });

    it('leaves metadata untouched when no reason is given', async () => {
      const s = sub({ metadata: { tier: 'pro' } });
      subscriptions.findOne.mockResolvedValue(s);
      await service.cancel(CALLER, 'sub-1', {});
      expect(s.metadata).toEqual({ tier: 'pro' });
    });
  });

  describe('reactivate', () => {
    const FUTURE = new Date(Date.now() + 86_400_000);
    const PAST = new Date(Date.now() - 86_400_000);

    it('is idempotent for an already-active subscription', async () => {
      const s = sub({ status: SubscriptionStatus.Active });
      subscriptions.findOne.mockResolvedValue(s);
      await expect(service.reactivate(CALLER, 'sub-1')).resolves.toBe(s);
      expect(adapter.uncancelSubscription).not.toHaveBeenCalled();
    });

    it.each([
      [SubscriptionStatus.Paused],
      [SubscriptionStatus.PastDue],
      [SubscriptionStatus.Expired],
    ])('refuses to reactivate a %s subscription', async (status) => {
      subscriptions.findOne.mockResolvedValue(sub({ status, currentPeriodEnd: FUTURE }));
      await expect(service.reactivate(CALLER, 'sub-1'))
        .rejects.toThrow(/only canceled subs in their paid period/);
    });

    it.each([
      ['the paid period already ended', PAST],
      ['there is no paid period on record', null],
    ])('refuses to reactivate when %s', async (_label, currentPeriodEnd) => {
      subscriptions.findOne.mockResolvedValue(sub({
        status: SubscriptionStatus.Canceled,
        currentPeriodEnd: currentPeriodEnd as Date | null,
      }));
      await expect(service.reactivate(CALLER, 'sub-1'))
        .rejects.toThrow(/create a new subscription instead/);
      expect(adapter.uncancelSubscription).not.toHaveBeenCalled();
    });

    it('reactivates a canceled subscription still inside its paid period', async () => {
      const s = sub({ status: SubscriptionStatus.Canceled, currentPeriodEnd: FUTURE });
      subscriptions.findOne.mockResolvedValue(s);
      await service.reactivate(CALLER, 'sub-1');
      expect(adapter.uncancelSubscription).toHaveBeenCalledWith('prov-sub-1');
      expect(s.status).toBe(SubscriptionStatus.Active);
      expect(s.cancelAt).toBeNull();
      expect(s.canceledAt).toBeNull();
    });

    it('clears the cancel reason but keeps the rest of the metadata', async () => {
      const s = sub({
        status: SubscriptionStatus.Canceled,
        currentPeriodEnd: FUTURE,
        metadata: { tier: 'pro', cancelReason: 'too expensive' },
      });
      subscriptions.findOne.mockResolvedValue(s);
      await service.reactivate(CALLER, 'sub-1');
      expect(s.metadata).toEqual({ tier: 'pro' });
    });

    it('copes with metadata that has no cancel reason', async () => {
      const s = sub({ status: SubscriptionStatus.Canceled, currentPeriodEnd: FUTURE, metadata: {} });
      subscriptions.findOne.mockResolvedValue(s);
      await expect(service.reactivate(CALLER, 'sub-1')).resolves.toBeDefined();
    });
  });

  describe('pause / resume', () => {
    it('is idempotent when already paused', async () => {
      const s = sub({ status: SubscriptionStatus.Paused });
      subscriptions.findOne.mockResolvedValue(s);
      await expect(service.pause(CALLER, 'sub-1')).resolves.toBe(s);
      expect(adapter.pauseSubscription).not.toHaveBeenCalled();
    });

    it('is idempotent when already active on resume', async () => {
      const s = sub({ status: SubscriptionStatus.Active });
      subscriptions.findOne.mockResolvedValue(s);
      await expect(service.resume(CALLER, 'sub-1')).resolves.toBe(s);
      expect(adapter.resumeSubscription).not.toHaveBeenCalled();
    });

    it('pauses through the provider and stores the reported status', async () => {
      const s = sub();
      subscriptions.findOne.mockResolvedValue(s);
      await service.pause(CALLER, 'sub-1');
      expect(adapter.pauseSubscription).toHaveBeenCalledWith('prov-sub-1');
      expect(s.status).toBe(SubscriptionStatus.Paused);
      expect(subscriptions.save).toHaveBeenCalledWith(s);
    });

    it('resumes a paused subscription', async () => {
      const s = sub({ status: SubscriptionStatus.Paused });
      subscriptions.findOne.mockResolvedValue(s);
      await service.resume(CALLER, 'sub-1');
      expect(adapter.resumeSubscription).toHaveBeenCalledWith('prov-sub-1');
      expect(s.status).toBe(SubscriptionStatus.Active);
    });

    // A past_due sub can be resumed back to active — that's how dunning
    // recovery is expressed through the API.
    it('resumes a past_due subscription', async () => {
      const s = sub({ status: SubscriptionStatus.PastDue });
      subscriptions.findOne.mockResolvedValue(s);
      await service.resume(CALLER, 'sub-1');
      expect(s.status).toBe(SubscriptionStatus.Active);
    });
  });
});
