import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Provider } from '../../common/enums';
import { App } from '../../database/entities';
import { ProviderCredentialsService } from '../../payment-providers/provider-credentials.service';
import { INTEGRATIONS } from '../integrations/integration-catalog';

/**
 * Apps have no provider column. An app's provider is, in order: the provider
 * it was added under (stored in platform_settings, see AppPreferencesService),
 * then its plans' providers, then its transactions'. Usually one; legacy apps
 * may mix providers.
 */
export type AppProviders = Map<string, Provider[]>;

export type AppHealth = 'live' | 'needs_attention' | 'not_ready' | 'inactive';

export interface AppStatusCheck {
  id: string;
  label: string;
  ok: boolean;
  /** `blocking` checks make the app not_ready; the rest only need attention. */
  blocking: boolean;
  detail: string | null;
  /** Path segment under /apps/<id>/ in the admin that fixes this check. */
  fix: string | null;
}

export interface AppStatus {
  status: AppHealth;
  checks: AppStatusCheck[];
}

/** Everything `computeAppStatus` needs, gathered by `AppStatusService`. */
export interface AppStatusInput {
  app: Pick<App, 'isActive' | 'apiKeyExpiresAt' | 'webhookUrl' | 'lastPingAt' | 'lastPingOk'
    | 'lastPingDetail' | 'marketplaceEnabled' | 'marketplaceFeePercent'>;
  providers: Provider[];
  unconfiguredProviders: Provider[];
  activePlans: number;
  failedDeliveries24h: number;
  pastDueSubs: number;
  failedCharges7d: number;
  now: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const KEY_EXPIRY_WARNING_DAYS = 14;

const PROVIDER_NAMES: Record<Provider, string> = {
  [Provider.Lemonsqueezy]: 'Lemon Squeezy',
  [Provider.Xendit]: 'Xendit',
  [Provider.Paymongo]: 'PayMongo',
};

export function computeAppStatus(i: AppStatusInput): AppStatus {
  const checks: AppStatusCheck[] = [];
  const names = i.providers.map((p) => PROVIDER_NAMES[p] ?? p).join(', ');

  checks.push({
    id: 'provider_configured',
    label: i.providers.length ? `${names} is configured` : 'Provider is set',
    ok: i.providers.length > 0 && i.unconfiguredProviders.length === 0,
    blocking: true,
    detail: !i.providers.length
      ? 'This app has no plans yet, so it has no provider.'
      : i.unconfiguredProviders.length
        ? `Missing credentials for ${i.unconfiguredProviders.map((p) => PROVIDER_NAMES[p] ?? p).join(', ')}.`
        : null,
    fix: i.providers.length ? null : 'plans',
  });

  // Xendit and PayMongo apps can take payments without plans (marketplace /
  // one-time), so plans are only required for Lemon Squeezy-only apps.
  if (i.providers.length > 0 && i.providers.every((p) => p === Provider.Lemonsqueezy)) {
    checks.push({
      id: 'plans',
      label: 'At least one active plan',
      ok: i.activePlans > 0,
      blocking: true,
      detail: i.activePlans > 0 ? `${i.activePlans} active` : 'Customers have nothing to subscribe to.',
      fix: 'plans',
    });
  }

  const expires = i.app.apiKeyExpiresAt ? new Date(i.app.apiKeyExpiresAt) : null;
  const expired = !!expires && expires.getTime() <= i.now.getTime();
  const expiringSoon = !!expires && !expired
    && expires.getTime() - i.now.getTime() < KEY_EXPIRY_WARNING_DAYS * DAY_MS;
  checks.push({
    id: 'api_key',
    label: 'API key is valid',
    ok: !expired && !expiringSoon,
    blocking: expired,
    detail: expired
      ? `Expired on ${expires!.toISOString().slice(0, 10)}.`
      : expires
        ? `Expires on ${expires.toISOString().slice(0, 10)}.`
        : 'Never expires.',
    fix: expired || expiringSoon ? 'settings' : null,
  });

  const pingFailed = i.app.lastPingAt != null && i.app.lastPingOk === false;
  checks.push({
    id: 'webhook',
    label: 'Webhook URL is set and reachable',
    ok: !!i.app.webhookUrl && !pingFailed,
    blocking: false,
    detail: !i.app.webhookUrl
      ? 'No webhook URL — the app will not hear about payments.'
      : pingFailed
        ? `Last test ping failed${i.app.lastPingDetail ? `: ${i.app.lastPingDetail}` : ''}.`
        : i.app.lastPingAt ? 'Last test ping succeeded.' : 'Not tested yet.',
    fix: 'settings',
  });

  checks.push({
    id: 'deliveries',
    label: 'No failed deliveries to the app (24h)',
    ok: i.failedDeliveries24h === 0,
    blocking: false,
    detail: i.failedDeliveries24h ? `${i.failedDeliveries24h} failed or exhausted.` : null,
    fix: 'webhooks',
  });

  checks.push({
    id: 'past_due',
    label: 'No past-due subscriptions',
    ok: i.pastDueSubs === 0,
    blocking: false,
    detail: i.pastDueSubs ? `${i.pastDueSubs} past due.` : null,
    fix: 'subscriptions',
  });

  checks.push({
    id: 'failed_charges',
    label: 'No failed subscription charges (7d)',
    ok: i.failedCharges7d === 0,
    blocking: false,
    detail: i.failedCharges7d ? `${i.failedCharges7d} failed.` : null,
    fix: 'payments',
  });

  if (i.app.marketplaceEnabled) {
    const feeSet = i.app.marketplaceFeePercent != null;
    checks.push({
      id: 'marketplace_fee',
      label: 'Marketplace fee is set',
      ok: feeSet,
      blocking: false,
      detail: feeSet ? `${i.app.marketplaceFeePercent}%` : 'Marketplace is on but has no fee.',
      fix: 'settings',
    });
  }

  let status: AppHealth;
  if (!i.app.isActive) status = 'inactive';
  else if (checks.some((c) => c.blocking && !c.ok)) status = 'not_ready';
  else if (checks.some((c) => !c.ok)) status = 'needs_attention';
  else status = 'live';
  return { status, checks };
}

@Injectable()
export class AppStatusService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly credentials: ProviderCredentialsService,
  ) {}

  /** Derived providers for the given apps (all apps when `appIds` is omitted). */
  async providersFor(appIds?: string[]): Promise<AppProviders> {
    const out: AppProviders = new Map();
    if (appIds && appIds.length === 0) return out;

    // 1. The provider the app was added under.
    const stored: Array<{ app_id: string; provider: Provider }> = await this.dataSource.query(
      `SELECT substring(key FROM 11) AS app_id, value->>'provider' AS provider
         FROM platform_settings
        WHERE key LIKE 'app_admin:%' AND value->>'provider' IS NOT NULL
          ${appIds ? 'AND key = ANY($1)' : ''}`,
      appIds ? [appIds.map((id) => `app_admin:${id}`)] : [],
    );
    const add = (appId: string, providers: Provider[]) => {
      const merged = [...(out.get(appId) ?? [])];
      for (const p of providers) if (!merged.includes(p)) merged.push(p);
      out.set(appId, merged);
    };
    for (const r of stored) add(r.app_id, [r.provider]);

    // 2. Its plans.
    const filter = appIds ? 'WHERE app_id = ANY($1)' : '';
    const params = appIds ? [appIds] : [];
    const fromPlans: Array<{ app_id: string; providers: Provider[] }> = await this.dataSource.query(
      `SELECT app_id, array_agg(DISTINCT provider::text ORDER BY provider::text) AS providers
         FROM plans ${filter} GROUP BY app_id`,
      params,
    );
    for (const r of fromPlans) add(r.app_id, r.providers);

    const missing = (appIds ?? []).filter((id) => !out.has(id));
    if (!appIds || missing.length) {
      const txFilter = appIds ? 'WHERE app_id = ANY($1)' : '';
      const fromTx: Array<{ app_id: string; providers: Provider[] }> = await this.dataSource.query(
        `SELECT app_id, array_agg(DISTINCT provider::text ORDER BY provider::text) AS providers
           FROM transactions ${txFilter} GROUP BY app_id`,
        appIds ? [missing] : [],
      );
      for (const r of fromTx) if (!out.has(r.app_id)) out.set(r.app_id, r.providers);
    }
    return out;
  }

  /** Every required credential (Integrations catalog) has a value. */
  isConfigured(provider: Provider): boolean {
    const spec = INTEGRATIONS.find((s) => s.provider === provider);
    if (!spec) return false;
    return spec.credentials.filter((c) => c.required).every((c) => !!this.credentials.get<string>(c.env));
  }

  async statusFor(app: App, now = new Date()): Promise<AppStatus> {
    const providers = (await this.providersFor([app.id])).get(app.id) ?? [];
    const since24h = new Date(now.getTime() - DAY_MS);
    const since7d = new Date(now.getTime() - 7 * DAY_MS);
    const [counts] = await this.dataSource.query(
      `SELECT
         (SELECT count(*) FROM plans WHERE app_id = $1 AND is_active)::int AS active_plans,
         (SELECT count(*) FROM webhook_events WHERE app_id = $1
            AND delivery_status IN ('failed', 'exhausted') AND created_at >= $2)::int AS failed_deliveries,
         (SELECT count(*) FROM subscriptions WHERE app_id = $1 AND status = 'past_due')::int AS past_due,
         (SELECT count(*) FROM transactions WHERE app_id = $1 AND type = 'subscription_payment'
            AND status = 'failed' AND created_at >= $3)::int AS failed_charges`,
      [app.id, since24h, since7d],
    );
    return computeAppStatus({
      app,
      providers,
      unconfiguredProviders: providers.filter((p) => !this.isConfigured(p)),
      activePlans: counts.active_plans,
      failedDeliveries24h: counts.failed_deliveries,
      pastDueSubs: counts.past_due,
      failedCharges7d: counts.failed_charges,
      now,
    });
  }
}
