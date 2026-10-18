import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { encryptSecret } from '../common/crypto';
import { ProviderCredential } from '../database/entities/provider-credential.entity';
import { ProviderCredentialsService } from './provider-credentials.service';

describe('ProviderCredentialsService', () => {
  const OLD_KEY = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  const env: Record<string, string | undefined> = {
    XENDIT_SECRET_KEY: 'xnd_development_fromenv',
    LEMONSQUEEZY_STORE_ID: '111',
  };
  let rows: ProviderCredential[];
  let repo: { find: jest.Mock };
  let manager: { delete: jest.Mock; save: jest.Mock; insert: jest.Mock };
  let service: ProviderCredentialsService;

  beforeAll(() => { process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = 'd'.repeat(64); });
  afterAll(() => { process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = OLD_KEY; });

  function row(key: string, value: string, extra: Partial<ProviderCredential> = {}): ProviderCredential {
    return {
      key, provider: 'xendit', valueEnc: encryptSecret(value),
      updatedBy: 'ops@acepay.ph', updatedAt: new Date('2026-10-12T00:00:00Z'), ...extra,
    } as ProviderCredential;
  }

  beforeEach(() => {
    rows = [];
    repo = { find: jest.fn(async () => rows) };
    manager = {
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn().mockResolvedValue(undefined),
      insert: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) };
    service = new ProviderCredentialsService(
      { get: (k: string) => env[k] } as unknown as ConfigService,
      repo as unknown as Repository<ProviderCredential>,
      dataSource as unknown as DataSource,
    );
  });

  afterEach(() => service.onModuleDestroy());

  it('falls back to the env when nothing is saved', async () => {
    await service.reload();
    expect(service.get('XENDIT_SECRET_KEY')).toBe('xnd_development_fromenv');
    expect(service.source('XENDIT_SECRET_KEY')).toBe('env');
    expect(service.source('PAYMONGO_SECRET_KEY')).toBeNull();
  });

  it('prefers a saved (decrypted) value over the env', async () => {
    rows = [row('XENDIT_SECRET_KEY', 'xnd_production_saved')];
    await service.reload();
    expect(service.get('XENDIT_SECRET_KEY')).toBe('xnd_production_saved');
    expect(service.source('XENDIT_SECRET_KEY')).toBe('database');
    expect(service.hasEnvValue('XENDIT_SECRET_KEY')).toBe(true);
    expect(service.lastChange('XENDIT_SECRET_KEY')).toEqual({
      updatedBy: 'ops@acepay.ph', updatedAt: new Date('2026-10-12T00:00:00Z'),
    });
    // Other keys still come from the env.
    expect(service.get('LEMONSQUEEZY_STORE_ID')).toBe('111');
  });

  it('skips a row it cannot decrypt (wrong key / corrupt) and uses the env value', async () => {
    rows = [{ ...row('XENDIT_SECRET_KEY', 'x'), valueEnc: 'not-a-real-ciphertext' }];
    await service.reload();
    expect(service.get('XENDIT_SECRET_KEY')).toBe('xnd_development_fromenv');
  });

  it('keeps serving the env when the table cannot be read (e.g. before the migration)', async () => {
    repo.find.mockRejectedValue(new Error('relation "provider_credentials" does not exist'));
    await expect(service.reload()).resolves.toBeUndefined();
    expect(service.get('XENDIT_SECRET_KEY')).toBe('xnd_development_fromenv');
  });

  it('keeps the last good copy when a later refresh fails', async () => {
    rows = [row('XENDIT_SECRET_KEY', 'xnd_production_saved')];
    await service.reload();
    repo.find.mockRejectedValue(new Error('connection lost'));
    await service.reload();
    expect(service.get('XENDIT_SECRET_KEY')).toBe('xnd_production_saved');
  });

  describe('save', () => {
    it('encrypts what it stores and audits without the value', async () => {
      await service.save('paymongo', { PAYMONGO_SECRET_KEY: 'sk_test_plain' }, 'ops@acepay.ph');
      const saved = manager.save.mock.calls[0][1];
      expect(saved).toMatchObject({ key: 'PAYMONGO_SECRET_KEY', provider: 'paymongo', updatedBy: 'ops@acepay.ph' });
      expect(saved.valueEnc).not.toContain('sk_test_plain');
      expect(manager.insert).toHaveBeenCalledWith(expect.anything(), {
        key: 'PAYMONGO_SECRET_KEY', provider: 'paymongo', action: 'set', actor: 'ops@acepay.ph',
      });
      expect(JSON.stringify(manager.insert.mock.calls)).not.toContain('sk_test_plain');
    });

    it('clears with null, auditing only when something was actually removed', async () => {
      await service.save('xendit', { XENDIT_SECRET_KEY: null }, 'ops@acepay.ph');
      expect(manager.delete).toHaveBeenCalledWith(expect.anything(), { key: 'XENDIT_SECRET_KEY' });
      expect(manager.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'cleared' }));

      manager.insert.mockClear();
      manager.delete.mockResolvedValue({ affected: 0 });
      await service.save('xendit', { XENDIT_SECRET_KEY: null }, 'ops@acepay.ph');
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('reloads right away so this process sees the change immediately', async () => {
      rows = [row('PAYMONGO_SECRET_KEY', 'sk_test_new', { provider: 'paymongo' })];
      await service.save('paymongo', { PAYMONGO_SECRET_KEY: 'sk_test_new' }, null);
      expect(service.get('PAYMONGO_SECRET_KEY')).toBe('sk_test_new');
    });
  });
});
