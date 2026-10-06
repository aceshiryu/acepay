jest.mock('../../database/entities', () => ({ PlatformSetting: class PlatformSetting {}, App: class App {} }));

import { Repository } from 'typeorm';
import { PlatformSetting } from '../../database/entities';
import { FALLBACK_DEFAULTS, MarketplaceDefaultsService } from './marketplace-defaults.service';

describe('MarketplaceDefaultsService (defaults for NEW apps)', () => {
  let settings: { findOne: jest.Mock; save: jest.Mock };
  let service: MarketplaceDefaultsService;
  let stored: Record<string, unknown> | null;

  beforeEach(() => {
    stored = null;
    settings = {
      findOne: jest.fn(async () => (stored ? { key: 'marketplace_defaults', value: stored, updatedBy: 'ace@acepay', updatedAt: new Date() } : null)),
      save: jest.fn(async (row) => { stored = row.value; return row; }),
    };
    service = new MarketplaceDefaultsService(settings as unknown as Repository<PlatformSetting>);
  });

  it('falls back to safe, off defaults when nothing is stored', async () => {
    expect(await service.get()).toEqual(expect.objectContaining(FALLBACK_DEFAULTS));
    expect(await service.appFields()).toEqual({
      marketplaceEnabled: false, marketplaceFeePercent: null,
      marketplaceFeeMinPercent: null, marketplaceFeeMaxPercent: null, marketplaceMinPayout: 50000,
    });
  });

  it('saves operator defaults and turns them into new-app columns', async () => {
    await service.update({ enabled: true, feePercent: 10, feeMinPercent: 8, feeMaxPercent: 15, minPayout: 30000 }, 'ace@acepay');
    expect(settings.save).toHaveBeenCalledWith(expect.objectContaining({ key: 'marketplace_defaults', updatedBy: 'ace@acepay' }));
    expect(await service.appFields()).toEqual({
      marketplaceEnabled: true, marketplaceFeePercent: 10,
      marketplaceFeeMinPercent: 8, marketplaceFeeMaxPercent: 15, marketplaceMinPayout: 30000,
    });
  });

  it('keeps fields that were not sent', async () => {
    stored = { enabled: false, feePercent: 10, feeMinPercent: 8, feeMaxPercent: 15, minPayout: 30000 };
    await service.update({ enabled: false, minPayout: 40000 }, null);
    expect(stored).toEqual({ enabled: false, feePercent: 10, feeMinPercent: 8, feeMaxPercent: 15, minPayout: 40000 });
  });

  it.each([
    [{ enabled: true }, 'marketplace_fee_required'],
    [{ enabled: false, feeMinPercent: 5 }, 'fee_bounds_incomplete'],
    [{ enabled: false, feeMinPercent: 15, feeMaxPercent: 5 }, 'fee_bounds_invalid'],
  ])('rejects %j (%s)', async (dto, code) => {
    await expect(service.update(dto, null)).rejects.toMatchObject({ response: { error: code } });
    expect(settings.save).not.toHaveBeenCalled();
  });

  it('never starts a new app "on" without a fee, even from odd stored data', async () => {
    stored = { enabled: true, feePercent: null, minPayout: 'nonsense' };
    expect(await service.appFields()).toEqual(expect.objectContaining({ marketplaceEnabled: false, marketplaceMinPayout: 50000 }));
  });
});
