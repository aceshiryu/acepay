jest.mock('../../database/entities', () => ({
  App: class App {}, AppConfigChange: class AppConfigChange {}, Customer: class Customer {},
  Plan: class Plan {}, Subscription: class Subscription {}, Transaction: class Transaction {},
  TransactionLog: class TransactionLog {}, User: class User {}, WebhookEvent: class WebhookEvent {},
  Merchant: class Merchant {}, Payout: class Payout {}, PayoutRun: class PayoutRun {},
  XenditSplitRule: class XenditSplitRule {}, PlatformSetting: class PlatformSetting {},
}));

import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { App, Merchant, Payout, Transaction } from '../../database/entities';
import { XenditPlatformClient } from '../../payment-providers/xendit-platform.client';
import { AppConfigService } from './app-config.service';
import { MarketplaceAdminService } from './marketplace-admin.service';

function app(o: Partial<App> = {}): App {
  return {
    id: 'app-bookly', name: 'BooklyPH', slug: 'booklyph', marketplaceEnabled: false,
    marketplaceFeePercent: null, marketplaceMinPayout: 50000,
    marketplaceFeeMinPercent: null, marketplaceFeeMaxPercent: null, ...o,
  } as App;
}

describe('MarketplaceAdminService.updateSettings', () => {
  let apps: { findOne: jest.Mock; save: jest.Mock };
  let appConfig: { record: jest.Mock };
  let service: MarketplaceAdminService;

  beforeEach(() => {
    apps = { findOne: jest.fn(), save: jest.fn((a) => Promise.resolve(a)) };
    appConfig = { record: jest.fn().mockResolvedValue(undefined) };
    service = new MarketplaceAdminService(
      apps as unknown as Repository<App>,
      {} as Repository<Merchant>,
      {} as Repository<Transaction>,
      {} as Repository<Payout>,
      {} as XenditPlatformClient,
      appConfig as unknown as AppConfigService,
    );
  });

  it('enables BooklyPH at 12% with a 10–15% self-service range and audits it as the admin', async () => {
    apps.findOne.mockResolvedValue(app());
    const row = await service.updateSettings('app-bookly', {
      enabled: true, feePercent: 12, feeMinPercent: 10, feeMaxPercent: 15,
    }, 'ace@acepay');
    expect(row).toEqual(expect.objectContaining({
      marketplaceEnabled: true, feePercent: 12, feeBounds: { min: 10, max: 15 }, minPayout: 50000,
    }));
    const [appId, actor, ref, before, after] = appConfig.record.mock.calls[0];
    expect([appId, actor, ref]).toEqual(['app-bookly', 'admin', 'ace@acepay']);
    expect(before).toEqual(expect.objectContaining({ marketplace_enabled: false, marketplace_fee_percent: null }));
    expect(after).toEqual(expect.objectContaining({
      marketplace_enabled: true, marketplace_fee_percent: 12,
      marketplace_fee_min_percent: 10, marketplace_fee_max_percent: 15,
    }));
  });

  it('requires a fee before enabling — no global default', async () => {
    apps.findOne.mockResolvedValue(app());
    await expect(service.updateSettings('app-bookly', { enabled: true }, null))
      .rejects.toMatchObject({ response: { error: 'marketplace_fee_required' } });
    expect(apps.save).not.toHaveBeenCalled();
  });

  it.each([
    [{ feeMinPercent: 10 }, 'fee_bounds_incomplete'],
    [{ feeMaxPercent: 15 }, 'fee_bounds_incomplete'],
    [{ feeMinPercent: 15, feeMaxPercent: 10 }, 'fee_bounds_invalid'],
  ])('rejects range %j (%s)', async (range, code) => {
    apps.findOne.mockResolvedValue(app({ marketplaceFeePercent: 12 }));
    await expect(service.updateSettings('app-bookly', { enabled: true, ...range }, null))
      .rejects.toMatchObject({ response: { error: code } });
    expect(appConfig.record).not.toHaveBeenCalled();
  });

  it('clears the range (fee becomes operator-only)', async () => {
    apps.findOne.mockResolvedValue(app({ marketplaceFeePercent: 12, marketplaceFeeMinPercent: 10, marketplaceFeeMaxPercent: 15 }));
    const row = await service.updateSettings('app-bookly', { enabled: true, feeMinPercent: null, feeMaxPercent: null }, null);
    expect(row.feeBounds).toBeNull();
  });

  it('404s an unknown app', async () => {
    apps.findOne.mockResolvedValue(null);
    await expect(service.updateSettings('nope', { enabled: false }, null)).rejects.toBeInstanceOf(NotFoundException);
  });
});
