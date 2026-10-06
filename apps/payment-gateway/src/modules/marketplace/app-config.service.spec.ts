jest.mock('../../database/entities', () => ({
  App: class App {}, AppConfigChange: class AppConfigChange {}, Customer: class Customer {},
  Plan: class Plan {}, Subscription: class Subscription {}, Transaction: class Transaction {},
  TransactionLog: class TransactionLog {}, User: class User {}, WebhookEvent: class WebhookEvent {},
  Merchant: class Merchant {}, Payout: class Payout {}, PayoutRun: class PayoutRun {},
  XenditSplitRule: class XenditSplitRule {}, PlatformSetting: class PlatformSetting {},
}));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { App, AppConfigChange } from '../../database/entities';
import { AppConfigService } from './app-config.service';

function bookly(o: Partial<App> = {}): App {
  return {
    id: 'app-bookly', name: 'BooklyPH', slug: 'booklyph',
    marketplaceEnabled: true, marketplaceFeePercent: 12, marketplaceMinPayout: 50000,
    marketplaceFeeMinPercent: 10, marketplaceFeeMaxPercent: 15,
    ...o,
  } as App;
}

describe('AppConfigService (/v1/app/config)', () => {
  let apps: { save: jest.Mock };
  let changes: { create: jest.Mock; save: jest.Mock; findAndCount: jest.Mock };
  let service: AppConfigService;

  beforeEach(() => {
    apps = { save: jest.fn((a) => Promise.resolve(a)) };
    changes = {
      create: jest.fn((c) => c),
      save: jest.fn((c) => Promise.resolve(c)),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    service = new AppConfigService(
      apps as unknown as Repository<App>,
      changes as unknown as Repository<AppConfigChange>,
    );
  });

  it('shows the app its settings and allowed fee range', () => {
    expect(service.view(bookly())).toEqual({
      appId: 'app-bookly', name: 'BooklyPH', slug: 'booklyph',
      mode: expect.stringMatching(/^(test|live|unknown)$/),
      paymentMethods: null,
      marketplace: { enabled: true, feePercent: 12, feeBounds: { min: 10, max: 15 }, minPayout: 50000 },
    });
  });

  it("tells the app whether money is real, from AcePay's Xendit key", () => {
    const before = process.env['XENDIT_SECRET_KEY'];
    try {
      process.env['XENDIT_SECRET_KEY'] = 'xnd_development_abc';
      expect(service.view(bookly()).mode).toBe('test');
      process.env['XENDIT_SECRET_KEY'] = 'xnd_production_abc';
      expect(service.view(bookly()).mode).toBe('live');
    } finally {
      if (before === undefined) delete process.env['XENDIT_SECRET_KEY'];
      else process.env['XENDIT_SECRET_KEY'] = before;
    }
  });

  it('reports no range when the operator set none', () => {
    expect(service.view(bookly({ marketplaceFeeMinPercent: null, marketplaceFeeMaxPercent: null })).marketplace.feeBounds).toBeNull();
  });

  it('lets the app change its fee inside the range and logs who did it', async () => {
    const app = bookly();
    const view = await service.updateFromApp(app, { feePercent: 13.5 }, 'ak_live_bookly1');
    expect(view.marketplace.feePercent).toBe(13.5);
    expect(apps.save).toHaveBeenCalledWith(expect.objectContaining({ marketplaceFeePercent: 13.5 }));
    expect(changes.save).toHaveBeenCalledWith([expect.objectContaining({
      appId: 'app-bookly', actor: 'app', actorRef: 'ak_live_bookly1',
      field: 'marketplace_fee_percent', oldValue: 12, newValue: 13.5,
    })]);
  });

  it.each([10, 15])('accepts the range edge %s%%', async (fee) => {
    await expect(service.updateFromApp(bookly(), { feePercent: fee }, null)).resolves.toBeDefined();
  });

  it.each([0, 9.99, 15.01, 100])('rejects %s%% outside the range — a leaked key cannot zero the fee', async (fee) => {
    await expect(service.updateFromApp(bookly(), { feePercent: fee }, null))
      .rejects.toMatchObject({ response: { error: 'fee_out_of_bounds', details: { min: 10, max: 15 } } });
    expect(apps.save).not.toHaveBeenCalled();
    expect(changes.save).not.toHaveBeenCalled();
  });

  it('refuses any fee change when the operator set no range', async () => {
    await expect(service.updateFromApp(bookly({ marketplaceFeeMinPercent: null, marketplaceFeeMaxPercent: null }), { feePercent: 12 }, null))
      .rejects.toMatchObject({ response: { error: 'fee_change_not_allowed' } });
  });

  it('still allows a minimum-payout change without a fee range', async () => {
    const app = bookly({ marketplaceFeeMinPercent: null, marketplaceFeeMaxPercent: null });
    const view = await service.updateFromApp(app, { minPayout: 100000 }, 'ak');
    expect(view.marketplace.minPayout).toBe(100000);
    expect(changes.save).toHaveBeenCalledWith([expect.objectContaining({
      field: 'marketplace_min_payout', oldValue: 50000, newValue: 100000,
    })]);
  });

  it('logs only fields that actually changed', async () => {
    await service.updateFromApp(bookly(), { feePercent: 12, minPayout: 60000 }, null);
    const logged = changes.save.mock.calls[0][0].map((c: { field: string }) => c.field);
    expect(logged).toEqual(['marketplace_min_payout']);
  });

  it('writes nothing when nothing changed', async () => {
    await service.updateFromApp(bookly(), { feePercent: 12 }, null);
    expect(changes.save).not.toHaveBeenCalled();
  });

  it('refuses when marketplace mode is off (the app cannot switch it on itself)', async () => {
    await expect(service.updateFromApp(bookly({ marketplaceEnabled: false }), { minPayout: 1 }, null))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an empty update', async () => {
    await expect(service.updateFromApp(bookly(), {}, null)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists changes newest first, filtered by app', async () => {
    await service.listChanges({ appId: 'app-bookly', page: 2, pageSize: 10 });
    expect(changes.findAndCount).toHaveBeenCalledWith(expect.objectContaining({
      where: { appId: 'app-bookly' }, order: { createdAt: 'DESC' }, skip: 10, take: 10,
    }));
  });
});
