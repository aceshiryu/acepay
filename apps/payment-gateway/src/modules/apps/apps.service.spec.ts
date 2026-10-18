jest.mock('../../database/entities', () => ({
  App: class App {}, AppConfigChange: class AppConfigChange {}, Customer: class Customer {},
  Plan: class Plan {}, Subscription: class Subscription {}, Transaction: class Transaction {},
  TransactionLog: class TransactionLog {}, User: class User {}, WebhookEvent: class WebhookEvent {},
  Merchant: class Merchant {}, Payout: class Payout {}, PayoutRun: class PayoutRun {},
  XenditSplitRule: class XenditSplitRule {}, PlatformSetting: class PlatformSetting {},
}));

import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { BillingMode, PlanInterval, PlanRegion, Provider, SubscriptionStatus } from '../../common/enums';
import { App } from '../../database/entities';
import { LemonsqueezyAdapter } from '../../payment-providers/lemonsqueezy.adapter';
import { PaymongoAdapter } from '../../payment-providers/paymongo.adapter';
import { CustomersAppService } from '../customers/customers-app.service';
import { AppConfigService } from '../marketplace/app-config.service';
import { MarketplaceDefaultsService } from '../marketplace/marketplace-defaults.service';
import { SubscriptionsAppService } from '../subscriptions/subscriptions-app.service';
import { AppsService, sandboxMetadata } from './apps.service';

describe('AppsService.create — marketplace defaults for new apps', () => {
  const OLD_KEY = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  let apps: { findOne: jest.Mock };
  let manager: { create: jest.Mock; save: jest.Mock };
  let defaults: { appFields: jest.Mock };
  let appConfig: { record: jest.Mock };
  let paymongo: { resolvePlan: jest.Mock };
  let service: AppsService;

  beforeAll(() => { process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = 'a'.repeat(64); });
  afterAll(() => { process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = OLD_KEY; });

  beforeEach(() => {
    apps = { findOne: jest.fn().mockResolvedValue(null) };
    manager = {
      create: jest.fn((_cls, v) => ({ ...v })),
      save: jest.fn(async (v) => ({ id: 'app-new', ...v })),
    };
    const dataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) };
    defaults = {
      appFields: jest.fn().mockResolvedValue({
        marketplaceEnabled: true, marketplaceFeePercent: 10,
        marketplaceFeeMinPercent: 8, marketplaceFeeMaxPercent: 15, marketplaceMinPayout: 30000,
      }),
    };
    appConfig = { record: jest.fn().mockResolvedValue(undefined) };
    paymongo = {
      resolvePlan: jest.fn().mockResolvedValue({
        planId: 'plan_pm1', name: 'BooklyPH — Pro', amount: 49900, currency: 'PHP',
        interval: PlanInterval.Monthly, intervalCount: 1,
      }),
    };
    service = new AppsService(
      apps as unknown as Repository<App>,
      dataSource as unknown as DataSource,
      {} as LemonsqueezyAdapter,
      paymongo as unknown as PaymongoAdapter,
      {} as CustomersAppService,
      {} as SubscriptionsAppService,
      defaults as unknown as MarketplaceDefaultsService,
      appConfig as unknown as AppConfigService,
    );
  });

  it('copies the current defaults onto the new app', async () => {
    const { app } = await service.create({ name: 'CourtFinder', billingMode: BillingMode.OneTime } as never);
    expect(app).toEqual(expect.objectContaining({
      marketplaceEnabled: true, marketplaceFeePercent: 10,
      marketplaceFeeMinPercent: 8, marketplaceFeeMaxPercent: 15, marketplaceMinPayout: 30000,
    }));
  });

  it('logs the starting settings as coming from the platform defaults', async () => {
    await service.create({ name: 'CourtFinder', billingMode: BillingMode.OneTime } as never);
    expect(appConfig.record).toHaveBeenCalledWith(
      'app-new', 'admin', 'platform defaults', {},
      expect.objectContaining({ marketplace_fee_percent: 10, marketplace_enabled: true }),
    );
  });

  it('does not log anything when creation fails', async () => {
    apps.findOne.mockResolvedValue({ id: 'taken' });
    await expect(service.create({ name: 'CourtFinder', billingMode: BillingMode.OneTime } as never)).rejects.toThrow();
    expect(appConfig.record).not.toHaveBeenCalled();
  });

  // Plans are optional: an app can be registered first and get plans later.
  it.each([
    ['with no plans field', {}],
    ['with an empty plans array', { plans: [] }],
  ])('registers a subscription app %s', async (_label, extra) => {
    const result = await service.create({ name: 'BooklyPH', billingMode: BillingMode.Subscription, ...extra } as never);
    expect(result.app).toEqual(expect.objectContaining({ name: 'BooklyPH', billingMode: BillingMode.Subscription }));
    expect(result.plans).toEqual([]);
  });

  describe('top-level provider (Add app under a provider)', () => {
    const pm = { provider: Provider.Paymongo, title: 'Pro', region: PlanRegion.Local, amount: 49900, currency: 'PHP', interval: PlanInterval.Monthly };

    it('lets a Xendit app register without plans and remembers its provider', async () => {
      const { plans } = await service.create({
        name: 'BooklyPH', billingMode: BillingMode.Subscription, provider: Provider.Xendit,
      } as never);
      expect(plans).toEqual([]);
      expect(manager.create).toHaveBeenCalledWith(expect.anything(), {
        key: 'app_admin:app-new', value: { provider: Provider.Xendit, hiddenMenus: [] },
      });
    });

    it('saves the chosen payment methods on create', async () => {
      const { app } = await service.create({
        name: 'BooklyPH', billingMode: BillingMode.Subscription, provider: Provider.Xendit, paymentMethods: ['gcash', 'CREDIT_CARD'],
      } as never);
      expect(app).toEqual(expect.objectContaining({ paymentMethods: expect.arrayContaining(['GCASH', 'CREDIT_CARD']) }));
    });

    it('requires at least one plan for Lemon Squeezy apps', async () => {
      await expect(service.create({
        name: 'BooklyPH', billingMode: BillingMode.Subscription, provider: Provider.Lemonsqueezy, plans: [],
      } as never)).rejects.toMatchObject({ response: { error: 'plans_required' } });
    });

    it('rejects a plan from a different provider before calling any provider', async () => {
      await expect(service.create({
        name: 'BooklyPH', billingMode: BillingMode.Subscription, provider: Provider.Xendit, plans: [pm],
      } as never)).rejects.toMatchObject({ response: { error: 'provider_mismatch' } });
      expect(paymongo.resolvePlan).not.toHaveBeenCalled();
    });

    it('accepts plans that all match the provider', async () => {
      const { plans } = await service.create({
        name: 'BooklyPH', billingMode: BillingMode.Subscription, provider: Provider.Paymongo, plans: [pm],
      } as never);
      expect(plans[0]).toEqual(expect.objectContaining({ provider: Provider.Paymongo }));
    });
  });

  describe('PayMongo inline plans', () => {
    const pmPlan = (extra: Record<string, unknown> = {}) => ({
      provider: Provider.Paymongo, title: 'Pro', region: PlanRegion.Local,
      amount: 49900, currency: 'PHP', interval: PlanInterval.Monthly, ...extra,
    });

    it('creates the plan in PayMongo and stores its id and values', async () => {
      const { plans } = await service.create({
        name: 'BooklyPH', billingMode: BillingMode.Subscription, plans: [pmPlan()],
      } as never);
      expect(paymongo.resolvePlan).toHaveBeenCalledWith(expect.objectContaining({
        existingPlanId: null, name: 'BooklyPH — Pro', amount: 49900, currency: 'PHP', interval: PlanInterval.Monthly,
      }));
      expect(plans[0]).toEqual(expect.objectContaining({
        provider: Provider.Paymongo, providerPlanId: 'plan_pm1', amount: 49900, currency: 'PHP',
      }));
    });

    it('links an existing PayMongo plan when its id is given', async () => {
      await service.create({
        name: 'BooklyPH', billingMode: BillingMode.Subscription,
        plans: [pmPlan({ paymongoPlanId: 'plan_existing', amount: undefined, currency: undefined, interval: undefined })],
      } as never);
      expect(paymongo.resolvePlan).toHaveBeenCalledWith(expect.objectContaining({ existingPlanId: 'plan_existing' }));
    });

    it('rejects missing fields before creating anything in PayMongo', async () => {
      await expect(service.create({
        name: 'BooklyPH', billingMode: BillingMode.Subscription, plans: [pmPlan({ amount: undefined })],
      } as never)).rejects.toMatchObject({ response: { error: 'paymongo_plan_fields_required' } });
      expect(paymongo.resolvePlan).not.toHaveBeenCalled();
    });

    // The PayMongo plan is a real side effect, so a registration that is going
    // to be rejected must not leave an orphan plan behind.
    it('does not create PayMongo plans when the plan slugs collide', async () => {
      await expect(service.create({
        name: 'BooklyPH', billingMode: BillingMode.Subscription, plans: [pmPlan(), pmPlan()],
      } as never)).rejects.toMatchObject({ response: { error: 'plan_slug_collision' } });
      expect(paymongo.resolvePlan).not.toHaveBeenCalled();
    });
  });
});

describe('AppsService — archive, restore and permanent delete', () => {
  const ARCHIVED_AT = new Date('2026-10-17T00:00:00Z');
  let apps: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  let manager: { count: jest.Mock; delete: jest.Mock };
  let service: AppsService;

  const app = (extra: Partial<App> = {}) =>
    ({ id: 'app-1', code: 'APP-000001', name: 'BooklyPH', isActive: true, archivedAt: null, ...extra }) as App;

  beforeEach(() => {
    apps = {
      findOne: jest.fn().mockResolvedValue(app()),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (a) => a),
    };
    manager = { count: jest.fn().mockResolvedValue(0), delete: jest.fn().mockResolvedValue({ affected: 1 }) };
    const dataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) };
    service = new AppsService(
      apps as unknown as Repository<App>, dataSource as unknown as DataSource,
      {} as LemonsqueezyAdapter, {} as PaymongoAdapter, {} as CustomersAppService,
      {} as SubscriptionsAppService, {} as MarketplaceDefaultsService, {} as AppConfigService,
    );
  });

  it('lists only apps that are not archived by default, and only archived ones on request', async () => {
    await service.findAll();
    expect(apps.find.mock.calls[0][0].where.archivedAt).toEqual(IsNull());
    await service.findAll({ archived: true });
    expect(apps.find.mock.calls[1][0].where.archivedAt).toEqual(Not(IsNull()));
  });

  it('archiving hides the app and stops its key, keeping the first archive date', async () => {
    const archived = await service.archive('app-1');
    expect(archived).toMatchObject({ isActive: false, archivedAt: expect.any(Date) });
    apps.findOne.mockResolvedValue(app({ isActive: false, archivedAt: ARCHIVED_AT }));
    expect((await service.archive('app-1')).archivedAt).toBe(ARCHIVED_AT);
  });

  it('restoring brings the app back still deactivated', async () => {
    apps.findOne.mockResolvedValue(app({ isActive: false, archivedAt: ARCHIVED_AT }));
    await expect(service.restore('app-1')).resolves.toMatchObject({ archivedAt: null, isActive: false });
  });

  it('refuses to activate an archived app until it is restored', async () => {
    apps.findOne.mockResolvedValue(app({ isActive: false, archivedAt: ARCHIVED_AT }));
    await expect(service.setActive('app-1', true)).rejects.toMatchObject({ response: { error: 'app_archived' } });
    expect(apps.save).not.toHaveBeenCalled();
  });

  describe('deletePermanently', () => {
    beforeEach(() => apps.findOne.mockResolvedValue(app({ isActive: false, archivedAt: ARCHIVED_AT })));

    it('deletes the app and its data, children with RESTRICT parents first', async () => {
      await expect(service.deletePermanently('app-1', 'BooklyPH', 'ops@acepay.ph'))
        .resolves.toEqual({ id: 'app-1', name: 'BooklyPH' });
      const deleted = manager.delete.mock.calls.map(([entity, where]) => [entity.name, where]);
      expect(deleted).toEqual([
        ['Subscription', { appId: 'app-1' }],
        ['Payout', { appId: 'app-1' }],
        ['PlatformSetting', { key: 'app_admin:app-1' }],
        ['App', { id: 'app-1' }],
      ]);
    });

    it('only works on an archived app', async () => {
      apps.findOne.mockResolvedValue(app());
      await expect(service.deletePermanently('app-1', 'BooklyPH', null))
        .rejects.toMatchObject({ response: { error: 'app_not_archived' } });
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it.each([[undefined], [''], ['bookly'], ['BooklyPH!']])('needs the exact app name (got %p)', async (name) => {
      await expect(service.deletePermanently('app-1', name, null))
        .rejects.toMatchObject({ response: { error: 'confirmation_mismatch' } });
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it('is refused while a subscription could still be billed', async () => {
      manager.count.mockResolvedValueOnce(2);
      await expect(service.deletePermanently('app-1', 'BooklyPH', null))
        .rejects.toMatchObject({ response: { error: 'app_has_live_subscriptions' } });
      expect(manager.count.mock.calls[0][1].where.status).toEqual(
        In([SubscriptionStatus.Active, SubscriptionStatus.PastDue, SubscriptionStatus.Paused]),
      );
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it('is refused while a payout is on its way to a merchant', async () => {
      manager.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      await expect(service.deletePermanently('app-1', 'BooklyPH', null))
        .rejects.toMatchObject({ response: { error: 'app_has_payouts_in_flight' } });
      expect(manager.delete).not.toHaveBeenCalled();
    });
  });
});

describe('sandboxMetadata', () => {
  it("fills the app's required keys the operator left out, keeping what was given", () => {
    expect(sandboxMetadata({ requiredMetadata: ['user_id', 'plan'] } as App, { user_id: 'qa-1' })).toEqual({
      user_id: 'qa-1', plan: 'sandbox', sandbox: true, triggeredBy: 'admin',
    });
  });

  it('always tags the run as sandbox, even if the operator tried to override it', () => {
    expect(sandboxMetadata({ requiredMetadata: [] } as unknown as App, { sandbox: false })).toMatchObject({ sandbox: true });
  });
});
