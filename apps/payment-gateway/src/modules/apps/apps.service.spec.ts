jest.mock('../../database/entities', () => ({
  App: class App {}, AppConfigChange: class AppConfigChange {}, Customer: class Customer {},
  Plan: class Plan {}, Subscription: class Subscription {}, Transaction: class Transaction {},
  TransactionLog: class TransactionLog {}, User: class User {}, WebhookEvent: class WebhookEvent {},
  Merchant: class Merchant {}, Payout: class Payout {}, PayoutRun: class PayoutRun {},
  XenditSplitRule: class XenditSplitRule {}, PlatformSetting: class PlatformSetting {},
}));

import { DataSource, Repository } from 'typeorm';
import { BillingMode } from '../../common/enums';
import { App } from '../../database/entities';
import { LemonsqueezyAdapter } from '../../payment-providers/lemonsqueezy.adapter';
import { CustomersAppService } from '../customers/customers-app.service';
import { AppConfigService } from '../marketplace/app-config.service';
import { MarketplaceDefaultsService } from '../marketplace/marketplace-defaults.service';
import { SubscriptionsAppService } from '../subscriptions/subscriptions-app.service';
import { AppsService } from './apps.service';

describe('AppsService.create — marketplace defaults for new apps', () => {
  const OLD_KEY = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  let apps: { findOne: jest.Mock };
  let manager: { create: jest.Mock; save: jest.Mock };
  let defaults: { appFields: jest.Mock };
  let appConfig: { record: jest.Mock };
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
    service = new AppsService(
      apps as unknown as Repository<App>,
      dataSource as unknown as DataSource,
      {} as LemonsqueezyAdapter,
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
});
