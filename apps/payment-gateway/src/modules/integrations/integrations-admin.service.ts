import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Provider } from '../../common/enums';
import { ProviderCredentialChange } from '../../database/entities';
import { isLemonTestMode } from '../../payment-providers/lemonsqueezy.adapter';
import { paymongoKeyMode } from '../../payment-providers/paymongo.adapter';
import { CredentialSource, ProviderCredentialsService } from '../../payment-providers/provider-credentials.service';
import { ProviderRegistry } from '../../payment-providers/provider.registry';
import { ConnectionCheck } from '../../payment-providers/provider.types';
import { xenditKeyMode } from '../../payment-providers/xendit.adapter';
import { ProviderHealth, SettingsAdminService } from '../settings/settings-admin.service';
import { INTEGRATIONS, integrationSpec, WebhookSpec } from './integration-catalog';

/** Longest value accepted from the Integrations page (keys are ~100 chars). */
const MAX_VALUE_LENGTH = 1000;

export interface CredentialView {
  env: string;
  label: string;
  secret: boolean;
  required: boolean;
  hint: string;
  set: boolean;
  /** Full value for non-secrets; `••••` + last 4 for secrets. Never the whole secret. */
  preview: string | null;
  /** `database` = saved on the Integrations page (wins), `env` = from .env. */
  source: CredentialSource | null;
  /** The .env also has a value, hidden by the saved one. Clearing restores it. */
  envFallback: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface CredentialChangeView {
  key: string;
  action: 'set' | 'cleared';
  actor: string | null;
  createdAt: string;
}

export interface IntegrationView {
  provider: Provider;
  name: string;
  region: string;
  usedFor: string;
  dashboardUrl: string;
  /** Every required credential is set. */
  configured: boolean;
  mode: ConnectionCheck['mode'];
  credentials: CredentialView[];
  webhooks: WebhookSpec[];
  health: Pick<ProviderHealth, 'status' | 'lastWebhookAt' | 'count24h'>;
  recentChanges: CredentialChangeView[];
}

export interface IntegrationsResponse {
  integrations: IntegrationView[];
  publicBaseHint: string | null;
}

/** Show enough of a secret to tell two keys apart, never enough to use it. */
export function maskSecret(value: string): string {
  return value.length >= 12 ? `••••${value.slice(-4)}` : '••••';
}

/**
 * Every provider in one place: which credentials are set (and whether they
 * come from the Integrations page or .env), test vs live, webhook URLs to
 * paste, webhook health, and saving credentials. Values saved here are
 * encrypted at rest (ProviderCredentialsService) and are never returned whole.
 */
@Injectable()
export class IntegrationsAdminService {
  constructor(
    private readonly config: ProviderCredentialsService,
    private readonly settings: SettingsAdminService,
    private readonly providers: ProviderRegistry,
    @InjectRepository(ProviderCredentialChange) private readonly changes: Repository<ProviderCredentialChange>,
  ) {}

  async list(): Promise<IntegrationsResponse> {
    const health = await this.settings.health();
    const recent = await this.changes.find({ order: { createdAt: 'DESC' }, take: 60 });
    const integrations = INTEGRATIONS.map((spec): IntegrationView => {
      const credentials = spec.credentials.map((c): CredentialView => {
        const value = this.config.get<string>(c.env) || null;
        const last = this.config.lastChange(c.env);
        return {
          env: c.env,
          label: c.label,
          secret: c.secret,
          required: c.required,
          hint: c.hint,
          set: value !== null,
          preview: value === null ? null : c.secret ? maskSecret(value) : value,
          source: value === null ? null : this.config.source(c.env),
          envFallback: this.config.hasEnvValue(c.env),
          updatedBy: last?.updatedBy ?? null,
          updatedAt: last?.updatedAt?.toISOString() ?? null,
        };
      });
      const h = health.providers.find((p) => p.provider === spec.provider);
      return {
        provider: spec.provider,
        name: spec.name,
        region: spec.region,
        usedFor: spec.usedFor,
        dashboardUrl: spec.dashboardUrl,
        configured: credentials.every((c) => !c.required || c.set),
        mode: this.mode(spec.provider),
        credentials,
        webhooks: spec.webhooks,
        health: {
          status: h?.status ?? 'misconfigured',
          lastWebhookAt: h?.lastWebhookAt ?? null,
          count24h: h?.count24h ?? 0,
        },
        recentChanges: recent
          .filter((r) => r.provider === spec.provider)
          .slice(0, 5)
          .map((r) => ({ key: r.key, action: r.action, actor: r.actor ?? null, createdAt: r.createdAt.toISOString() })),
      };
    });
    return { integrations, publicBaseHint: health.publicBaseHint };
  }

  test(provider: Provider): Promise<ConnectionCheck> {
    return this.providers.resolve(provider).checkConnection();
  }

  /**
   * Save credentials typed on the Integrations page. A string saves (encrypted)
   * and overrides .env; `null` removes the saved value so .env applies again.
   * Keys must belong to this provider; values are trimmed and checked by the
   * catalog's validators. All-or-nothing: one bad value saves nothing.
   */
  async saveCredentials(
    provider: Provider, values: Record<string, unknown>, actor: string | null,
  ): Promise<IntegrationView> {
    const spec = integrationSpec(provider);
    if (!spec) throw new BadRequestException({ error: 'unknown_provider', message: `Unknown provider: ${provider}` });
    const entries = Object.entries(values ?? {});
    if (entries.length === 0) {
      throw new BadRequestException({ error: 'no_values', message: 'Nothing to save' });
    }

    const clean: Record<string, string | null> = {};
    const problems: string[] = [];
    for (const [key, raw] of entries) {
      const cred = spec.credentials.find((c) => c.env === key);
      if (!cred) {
        problems.push(`${key} is not a ${spec.name} setting`);
        continue;
      }
      if (raw === null) {
        clean[key] = null;
        continue;
      }
      if (typeof raw !== 'string') {
        problems.push(`${cred.label} must be text`);
        continue;
      }
      const value = raw.trim();
      if (!value) {
        problems.push(`${cred.label} is empty — to stop using a saved value, clear it instead`);
        continue;
      }
      if (value.length > MAX_VALUE_LENGTH || /[\r\n]/.test(value)) {
        problems.push(`${cred.label} doesn't look like a valid value`);
        continue;
      }
      const invalid = cred.validate?.(value);
      if (invalid) {
        problems.push(invalid);
        continue;
      }
      clean[key] = value;
    }
    if (problems.length > 0) {
      throw new BadRequestException({ error: 'invalid_credentials', message: problems.join('. ') });
    }

    await this.config.save(provider, clean, actor);
    const { integrations } = await this.list();
    return integrations.find((i) => i.provider === provider) as IntegrationView;
  }

  /** Test vs live from config alone (no network), so the page can badge it on load. */
  private mode(provider: Provider): ConnectionCheck['mode'] {
    switch (provider) {
      case Provider.Lemonsqueezy:
        return isLemonTestMode(this.config.get<string>('LEMONSQUEEZY_TEST_MODE')) ? 'test' : 'live';
      case Provider.Xendit:
        return xenditKeyMode(this.config.get<string>('XENDIT_SECRET_KEY'));
      case Provider.Paymongo:
        return paymongoKeyMode(this.config.get<string>('PAYMONGO_SECRET_KEY'));
      default:
        return 'unknown';
    }
  }
}
