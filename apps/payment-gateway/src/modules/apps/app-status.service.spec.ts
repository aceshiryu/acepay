jest.mock('../../database/entities', () => ({ App: class App {} }));

import { DataSource } from 'typeorm';
import { Provider } from '../../common/enums';
import { App } from '../../database/entities';
import { ProviderCredentialsService } from '../../payment-providers/provider-credentials.service';
import { AppStatusInput, AppStatusService, computeAppStatus } from './app-status.service';

const NOW = new Date('2026-10-12T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function input(over: Partial<AppStatusInput> = {}, app: Partial<AppStatusInput['app']> = {}): AppStatusInput {
  return {
    app: {
      isActive: true, apiKeyExpiresAt: null, webhookUrl: 'https://booklyph.test/hooks',
      lastPingAt: new Date(NOW.getTime() - DAY), lastPingOk: true, lastPingDetail: null,
      marketplaceEnabled: false, marketplaceFeePercent: null, ...app,
    },
    providers: [Provider.Lemonsqueezy],
    unconfiguredProviders: [],
    activePlans: 2,
    failedDeliveries24h: 0,
    pastDueSubs: 0,
    failedCharges7d: 0,
    now: NOW,
    ...over,
  };
}

const check = (r: ReturnType<typeof computeAppStatus>, id: string) => r.checks.find((c) => c.id === id)!;

describe('computeAppStatus', () => {
  it('is live when every check passes', () => {
    const r = computeAppStatus(input());
    expect(r.status).toBe('live');
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it('is inactive when the app is turned off, even if other checks fail', () => {
    expect(computeAppStatus(input({ activePlans: 0 }, { isActive: false })).status).toBe('inactive');
  });

  it.each<[string, Partial<AppStatusInput>, Partial<AppStatusInput['app']>, string]>([
    ['provider not configured', { unconfiguredProviders: [Provider.Lemonsqueezy] }, {}, 'provider_configured'],
    ['no provider at all (no plans, no transactions)', { providers: [] }, {}, 'provider_configured'],
    ['no active plans', { activePlans: 0 }, {}, 'plans'],
    ['API key expired', {}, { apiKeyExpiresAt: new Date(NOW.getTime() - 1000) }, 'api_key'],
  ])('is not_ready when %s', (_name, over, app, failing) => {
    const r = computeAppStatus(input(over, app));
    expect(r.status).toBe('not_ready');
    expect(check(r, failing).ok).toBe(false);
  });

  it.each<[string, Partial<AppStatusInput>, Partial<AppStatusInput['app']>, string]>([
    ['the last ping failed', {}, { lastPingOk: false, lastPingDetail: 'HTTP 500' }, 'webhook'],
    ['there is no webhook URL', {}, { webhookUrl: null }, 'webhook'],
    ['deliveries failed in the last 24h', { failedDeliveries24h: 3 }, {}, 'deliveries'],
    ['subscriptions are past due', { pastDueSubs: 1 }, {}, 'past_due'],
    ['subscription charges failed in 7d', { failedCharges7d: 2 }, {}, 'failed_charges'],
    ['the API key expires within 14 days', {}, { apiKeyExpiresAt: new Date(NOW.getTime() + 5 * DAY) }, 'api_key'],
    ['marketplace is on with no fee', {}, { marketplaceEnabled: true, marketplaceFeePercent: null }, 'marketplace_fee'],
  ])('needs attention when %s', (_name, over, app, failing) => {
    const r = computeAppStatus(input(over, app));
    expect(r.status).toBe('needs_attention');
    expect(check(r, failing).ok).toBe(false);
  });

  it('does not require plans for Xendit apps (they can charge without plans)', () => {
    const r = computeAppStatus(input({ providers: [Provider.Xendit], activePlans: 0 }));
    expect(r.status).toBe('live');
    expect(r.checks.some((c) => c.id === 'plans')).toBe(false);
  });

  it('does not require plans for PayMongo apps (one-time payments work without them)', () => {
    expect(computeAppStatus(input({ providers: [Provider.Paymongo], activePlans: 0 })).status).toBe('live');
  });

  it('treats a key expiring beyond 14 days as fine', () => {
    const r = computeAppStatus(input({}, { apiKeyExpiresAt: new Date(NOW.getTime() + 30 * DAY) }));
    expect(r.status).toBe('live');
  });

  it('a never-tested webhook URL is not a problem', () => {
    expect(computeAppStatus(input({}, { lastPingAt: null, lastPingOk: null })).status).toBe('live');
  });

  it('only adds the marketplace check for marketplace apps', () => {
    expect(computeAppStatus(input()).checks.some((c) => c.id === 'marketplace_fee')).toBe(false);
    const r = computeAppStatus(input({}, { marketplaceEnabled: true, marketplaceFeePercent: 12 }));
    expect(check(r, 'marketplace_fee').ok).toBe(true);
  });
});

describe('AppStatusService', () => {
  let query: jest.Mock;
  let creds: { get: jest.Mock };
  let service: AppStatusService;

  beforeEach(() => {
    query = jest.fn();
    creds = { get: jest.fn() };
    service = new AppStatusService(
      { query } as unknown as DataSource,
      creds as unknown as ProviderCredentialsService,
    );
  });

  it('derives providers from plans and falls back to transactions for apps with no plans', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { app_id: 'a1', providers: ['xendit'] },
        { app_id: 'a2', providers: ['lemonsqueezy', 'xendit'] },
      ])
      .mockResolvedValueOnce([{ app_id: 'a3', providers: ['paymongo'] }]);
    const out = await service.providersFor(['a1', 'a2', 'a3', 'a4']);
    expect(out.get('a1')).toEqual(['xendit']);
    expect(out.get('a2')).toEqual(['lemonsqueezy', 'xendit']);
    expect(out.get('a3')).toEqual(['paymongo']);
    expect(out.has('a4')).toBe(false);
    // The fallback only asks about the apps the plans query did not cover.
    expect(query.mock.calls[2][1]).toEqual([['a3', 'a4']]);
  });

  it('puts the provider the app was added under first, then plan providers', async () => {
    query
      .mockResolvedValueOnce([{ app_id: 'a1', provider: 'xendit' }, { app_id: 'a2', provider: 'xendit' }])
      .mockResolvedValueOnce([{ app_id: 'a1', providers: ['lemonsqueezy', 'xendit'] }]);
    const out = await service.providersFor(['a1', 'a2']);
    expect(out.get('a1')).toEqual(['xendit', 'lemonsqueezy']);
    // A Xendit app with no plans still has its provider.
    expect(out.get('a2')).toEqual(['xendit']);
    expect(query.mock.calls[0][1]).toEqual([['app_admin:a1', 'app_admin:a2']]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('skips the transactions fallback when every app has plans', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ app_id: 'a1', providers: ['xendit'] }]);
    await service.providersFor(['a1']);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('runs no query for an empty id list', async () => {
    expect((await service.providersFor([])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('a provider is configured only when every required credential has a value', () => {
    creds.get.mockImplementation((k: string) => (k === 'XENDIT_SECRET_KEY' ? 'xnd_development_x' : undefined));
    expect(service.isConfigured(Provider.Xendit)).toBe(false);
    creds.get.mockImplementation((k: string) =>
      ({ XENDIT_SECRET_KEY: 'xnd_development_x', XENDIT_WEBHOOK_TOKEN: 'tok' } as Record<string, string>)[k]);
    expect(service.isConfigured(Provider.Xendit)).toBe(true);
  });

  it('statusFor combines derived provider, credentials and counts', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ app_id: 'a1', providers: ['xendit'] }])
      .mockResolvedValueOnce([{ active_plans: 1, failed_deliveries: 0, past_due: 2, failed_charges: 0 }]);
    creds.get.mockReturnValue('set');
    const app = {
      id: 'a1', isActive: true, apiKeyExpiresAt: null, webhookUrl: 'https://x.test',
      lastPingAt: null, lastPingOk: null, lastPingDetail: null, marketplaceEnabled: false, marketplaceFeePercent: null,
    } as unknown as App;
    const r = await service.statusFor(app, NOW);
    expect(r.status).toBe('needs_attention');
    expect(r.checks.find((c) => c.id === 'past_due')!.detail).toBe('2 past due.');
    expect(query.mock.calls[2][1][0]).toBe('a1');
  });
});
