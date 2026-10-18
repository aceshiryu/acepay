jest.mock('../../database/entities/platform-setting.entity', () => ({ PlatformSetting: class PlatformSetting {} }));

import { Repository } from 'typeorm';
import { Provider } from '../../common/enums';
import { PlatformSetting } from '../../database/entities/platform-setting.entity';
import { AppPreferencesService } from './app-preferences.service';

describe('AppPreferencesService', () => {
  let rows: Map<string, Record<string, unknown>>;
  let repo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  let service: AppPreferencesService;

  beforeEach(() => {
    rows = new Map();
    repo = {
      findOne: jest.fn(async ({ where: { key } }) => (rows.has(key) ? { key, value: rows.get(key) } : null)),
      find: jest.fn(async () => [...rows].map(([key, value]) => ({ key, value }))),
      save: jest.fn(async (r) => { rows.set(r.key, r.value); return r; }),
    };
    service = new AppPreferencesService(repo as unknown as Repository<PlatformSetting>);
  });

  it('defaults to no provider and nothing hidden', async () => {
    expect(await service.get('a1')).toEqual({ provider: null, hiddenMenus: [] });
  });

  it('keeps the stored provider when only menus change', async () => {
    rows.set('app_admin:a1', { provider: 'xendit', hiddenMenus: [] });
    const next = await service.set('a1', { hiddenMenus: ['plans', 'plans', 'invoices'] }, 'ace@example.com');
    expect(next).toEqual({ provider: Provider.Xendit, hiddenMenus: ['plans', 'invoices'] });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ key: 'app_admin:a1', updatedBy: 'ace@example.com' }));
  });

  it('rejects menu items that cannot be hidden', async () => {
    await expect(service.set('a1', { hiddenMenus: ['settings'] }, null)).rejects.toMatchObject({ response: { error: 'unknown_menu' } });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('ignores junk in stored values', async () => {
    rows.set('app_admin:a1', { provider: 'stripe', hiddenMenus: ['plans', 42, 'overview'] });
    expect(await service.get('a1')).toEqual({ provider: null, hiddenMenus: ['plans'] });
  });

  it('getMany returns defaults for apps with no row', async () => {
    rows.set('app_admin:a1', { provider: 'paymongo', hiddenMenus: ['refunds'] });
    const out = await service.getMany(['a1', 'a2']);
    expect(out.get('a1')).toEqual({ provider: Provider.Paymongo, hiddenMenus: ['refunds'] });
    expect(out.get('a2')).toEqual({ provider: null, hiddenMenus: [] });
  });
});
