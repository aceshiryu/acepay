// The entity barrel's circular import (App → Customer → Subscription → Plan →
// App) is a TDZ error under swc-jest. SettingsAdminService only needs
// WebhookEvent as a DI token and is mocked here anyway, so stub the barrel.
jest.mock('../../database/entities', () => ({
  WebhookEvent: class WebhookEvent {},
  ProviderCredentialChange: class ProviderCredentialChange {},
}));

import { Repository } from 'typeorm';
import { Provider } from '../../common/enums';
import { ProviderCredentialsService } from '../../payment-providers/provider-credentials.service';
import { ProviderRegistry } from '../../payment-providers/provider.registry';
import { ProviderCredentialChange } from '../../database/entities';
import { SettingsAdminService, SettingsHealth } from '../settings/settings-admin.service';
import { IntegrationsAdminService, maskSecret } from './integrations-admin.service';

const FULL_ENV: Record<string, string> = {
  LEMONSQUEEZY_API_KEY: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.lsapikey9f2a',
  LEMONSQUEEZY_STORE_ID: '12345',
  LEMONSQUEEZY_WEBHOOK_SECRET: 'whsec_lemon_abcdef',
  XENDIT_SECRET_KEY: 'xnd_production_supersecretc0de',
  XENDIT_WEBHOOK_TOKEN: 'callbacktoken_7777',
  PUBLIC_BASE_URL: 'https://pay.example.com',
};

function healthFixture(): SettingsHealth {
  return {
    publicBaseHint: 'https://pay.example.com',
    providers: [
      { provider: Provider.Lemonsqueezy, envOk: true, missingEnv: [], webhookPath: '/v1/webhooks/lemonsqueezy',
        lastWebhookAt: '2026-10-12T01:00:00.000Z', count24h: 4, status: 'ok' },
      { provider: Provider.Xendit, envOk: true, missingEnv: [], webhookPath: '/v1/webhooks/xendit',
        lastWebhookAt: null, count24h: 0, status: 'never_received' },
      { provider: Provider.Paymongo, envOk: false, missingEnv: ['PAYMONGO_SECRET_KEY'], webhookPath: '/v1/webhooks/paymongo',
        lastWebhookAt: null, count24h: 0, status: 'misconfigured' },
    ],
  };
}

/** `saved` stands in for values saved on the Integrations page (they win over env). */
function setup(env: Record<string, string | undefined> = FULL_ENV, saved: Record<string, string> = {}) {
  const config = {
    get: (k: string) => saved[k] ?? env[k],
    source: (k: string) => (k in saved ? 'database' : env[k] ? 'env' : null),
    hasEnvValue: (k: string) => !!env[k],
    lastChange: (k: string) => (k in saved ? { updatedBy: 'ops@acepay.ph', updatedAt: new Date('2026-10-12T02:00:00Z') } : null),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const settings = { health: jest.fn().mockResolvedValue(healthFixture()) } as unknown as SettingsAdminService;
  const check = jest.fn().mockResolvedValue({ ok: true, mode: 'test', detail: 'fine' });
  const registry = { resolve: jest.fn().mockReturnValue({ checkConnection: check }) } as unknown as ProviderRegistry;
  const changes = { find: jest.fn().mockResolvedValue([]) } as unknown as Repository<ProviderCredentialChange>;
  const service = new IntegrationsAdminService(
    config as unknown as ProviderCredentialsService, settings, registry, changes,
  );
  return { service, registry, check, config, changes };
}

describe('IntegrationsAdminService', () => {
  describe('list', () => {
    it('never returns a whole secret', async () => {
      const { service } = setup();
      const json = JSON.stringify(await service.list());
      for (const env of ['LEMONSQUEEZY_API_KEY', 'LEMONSQUEEZY_WEBHOOK_SECRET', 'XENDIT_SECRET_KEY', 'XENDIT_WEBHOOK_TOKEN']) {
        expect(json).not.toContain(FULL_ENV[env]);
      }
    });

    it('masks secrets to the last 4 and shows non-secrets in full', async () => {
      const { service } = setup();
      const { integrations } = await service.list();
      const ls = integrations.find((i) => i.provider === Provider.Lemonsqueezy)!;
      const byEnv = Object.fromEntries(ls.credentials.map((c) => [c.env, c]));
      expect(byEnv.LEMONSQUEEZY_API_KEY.preview).toBe('••••9f2a');
      expect(byEnv.LEMONSQUEEZY_STORE_ID.preview).toBe('12345');
      expect(byEnv.LEMONSQUEEZY_VARIANT_ID).toMatchObject({ set: false, preview: null });
    });

    it('is configured only when every required credential is set (optional ones do not count)', async () => {
      const { service } = setup({ ...FULL_ENV, XENDIT_WEBHOOK_TOKEN: undefined });
      const { integrations } = await service.list();
      const byProvider = Object.fromEntries(integrations.map((i) => [i.provider, i]));
      // LS has no variant id / test mode set — both optional.
      expect(byProvider[Provider.Lemonsqueezy].configured).toBe(true);
      expect(byProvider[Provider.Xendit].configured).toBe(false);
    });

    it('treats an empty env var as not set', async () => {
      const { service } = setup({ ...FULL_ENV, LEMONSQUEEZY_STORE_ID: '' });
      const ls = (await service.list()).integrations.find((i) => i.provider === Provider.Lemonsqueezy)!;
      expect(ls.credentials.find((c) => c.env === 'LEMONSQUEEZY_STORE_ID')).toMatchObject({ set: false, preview: null });
      expect(ls.configured).toBe(false);
    });

    it('derives test/live from config: LS test-mode flag, Xendit key prefix', async () => {
      const { service } = setup();
      const modes = Object.fromEntries((await service.list()).integrations.map((i) => [i.provider, i.mode]));
      expect(modes).toEqual({ [Provider.Lemonsqueezy]: 'test', [Provider.Xendit]: 'live', [Provider.Paymongo]: 'unknown' });
    });

    it('carries webhook paths + health through', async () => {
      const { service } = setup();
      const { integrations, publicBaseHint } = await service.list();
      const xendit = integrations.find((i) => i.provider === Provider.Xendit)!;
      expect(publicBaseHint).toBe('https://pay.example.com');
      expect(xendit.webhooks.map((w) => w.path)).toEqual(['/v1/webhooks/xendit', '/v1/webhooks/xendit/marketplace']);
      expect(xendit.health).toEqual({ status: 'never_received', lastWebhookAt: null, count24h: 0 });
    });
  });

  describe('list — saved credentials', () => {
    it('says where each value comes from and who saved it, still masked', async () => {
      const { service } = setup(FULL_ENV, { XENDIT_SECRET_KEY: 'xnd_development_savedkey1234' });
      const xendit = (await service.list()).integrations.find((i) => i.provider === Provider.Xendit)!;
      const key = xendit.credentials.find((c) => c.env === 'XENDIT_SECRET_KEY')!;
      expect(key).toMatchObject({
        source: 'database', envFallback: true, preview: '••••1234',
        updatedBy: 'ops@acepay.ph', updatedAt: '2026-10-12T02:00:00.000Z',
      });
      expect(xendit.mode).toBe('test'); // the saved key wins over the live env key
      expect(xendit.credentials.find((c) => c.env === 'XENDIT_WEBHOOK_TOKEN')!.source).toBe('env');
    });

    it('lists PayMongo, not connected until its keys are set', async () => {
      const { service } = setup();
      const pm = (await service.list()).integrations.find((i) => i.provider === Provider.Paymongo)!;
      expect(pm.configured).toBe(false);
      expect(pm.webhooks[0].path).toBe('/v1/webhooks/paymongo');
      const connected = setup({ ...FULL_ENV, PAYMONGO_SECRET_KEY: 'sk_live_x', PAYMONGO_PUBLIC_KEY: 'pk_live_x', PAYMONGO_WEBHOOK_SECRET: 'whsk_x' });
      const pm2 = (await connected.service.list()).integrations.find((i) => i.provider === Provider.Paymongo)!;
      expect(pm2).toMatchObject({ configured: true, mode: 'live' });
    });
  });

  describe('saveCredentials', () => {
    it('trims and saves values, and clears with null', async () => {
      const { service, config } = setup();
      await service.saveCredentials(Provider.Paymongo, {
        PAYMONGO_SECRET_KEY: '  sk_test_abc  ', PAYMONGO_PAYMENT_METHODS: null,
      }, 'ops@acepay.ph');
      expect(config.save).toHaveBeenCalledWith(
        Provider.Paymongo, { PAYMONGO_SECRET_KEY: 'sk_test_abc', PAYMONGO_PAYMENT_METHODS: null }, 'ops@acepay.ph',
      );
    });

    it.each([
      ['a key from another provider', { XENDIT_SECRET_KEY: 'xnd_development_x' }, /not a PayMongo setting/],
      ['an empty value', { PAYMONGO_SECRET_KEY: '   ' }, /empty/],
      ['a wrong key prefix', { PAYMONGO_SECRET_KEY: 'pk_test_oops' }, /should start with sk_test_ or sk_live_/],
      ['a multi-line value', { PAYMONGO_WEBHOOK_SECRET: 'whsk_a\nb' }, /valid value/],
      ['an unknown checkout method', { PAYMONGO_PAYMENT_METHODS: 'card, bitcoin' }, /Unknown PayMongo method: bitcoin/],
      ['a non-string value', { PAYMONGO_SECRET_KEY: 42 }, /must be text/],
    ])('rejects %s and saves nothing', async (_label, values, message) => {
      const { service, config } = setup();
      await expect(service.saveCredentials(Provider.Paymongo, values, 'ops@acepay.ph'))
        .rejects.toMatchObject({ response: { error: 'invalid_credentials', message: expect.stringMatching(message) } });
      expect(config.save).not.toHaveBeenCalled();
    });

    it('is all-or-nothing: one bad value blocks the good ones', async () => {
      const { service, config } = setup();
      await expect(service.saveCredentials(Provider.Lemonsqueezy, {
        LEMONSQUEEZY_STORE_ID: '12345', LEMONSQUEEZY_TEST_MODE: 'False',
      }, null)).rejects.toMatchObject({ response: { error: 'invalid_credentials' } });
      expect(config.save).not.toHaveBeenCalled();
    });

    it('refuses an empty request', async () => {
      const { service } = setup();
      await expect(service.saveCredentials(Provider.Xendit, {}, null))
        .rejects.toMatchObject({ response: { error: 'no_values' } });
    });
  });

  describe('test', () => {
    it('delegates to the provider adapter', async () => {
      const { service, registry, check } = setup();
      await expect(service.test(Provider.Xendit)).resolves.toEqual({ ok: true, mode: 'test', detail: 'fine' });
      expect(registry.resolve).toHaveBeenCalledWith(Provider.Xendit);
      expect(check).toHaveBeenCalledTimes(1);
    });
  });

  describe('maskSecret', () => {
    it.each([
      ['abcdefghijkl', '••••ijkl'],
      ['short', '••••'],          // too short to safely reveal any of it
      ['', '••••'],
    ])('%p → %p', (value, expected) => expect(maskSecret(value)).toBe(expected));
  });
});
