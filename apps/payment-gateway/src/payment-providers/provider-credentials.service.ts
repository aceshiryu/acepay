import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { decryptSecret, encryptSecret } from '../common/crypto';
// Direct entity imports, not the barrel: adapters import this service, and the
// barrel's circular import (App → Customer → Subscription → Plan → App) would
// then load in every adapter's test.
import { ProviderCredentialChange } from '../database/entities/provider-credential-change.entity';
import { ProviderCredential } from '../database/entities/provider-credential.entity';

/** How often each process re-reads the table, so a key saved in the admin
 *  reaches the worker (and any other gateway instance) without a restart. */
export const CREDENTIAL_REFRESH_MS = 30_000;

export type CredentialSource = 'database' | 'env';

/**
 * The one place provider adapters read their keys from. A value saved on the
 * admin Integrations page (encrypted in `provider_credentials`) wins; otherwise
 * the env var of the same name. Reads are synchronous from an in-memory copy,
 * so adapters keep their `this.config.get('X')` shape.
 *
 * If the table can't be read (e.g. the migration hasn't run yet) it logs and
 * keeps serving the env values — a credentials problem must never stop boot.
 */
@Injectable()
export class ProviderCredentialsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProviderCredentialsService.name);
  private overrides = new Map<string, { value: string; updatedBy: string | null; updatedAt: Date }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly env: ConfigService,
    @InjectRepository(ProviderCredential) private readonly rows: Repository<ProviderCredential>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
    this.timer = setInterval(() => { void this.reload(); }, CREDENTIAL_REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Same signature as ConfigService.get for the keys adapters use. */
  get<T = string>(key: string): T | undefined {
    const o = this.overrides.get(key);
    if (o) return o.value as unknown as T;
    return this.env.get<T>(key);
  }

  /** Where the effective value comes from, or null when it's unset everywhere. */
  source(key: string): CredentialSource | null {
    if (this.overrides.has(key)) return 'database';
    return this.env.get<string>(key) ? 'env' : null;
  }

  /** Whether the .env has its own value (shown when an override hides it). */
  hasEnvValue(key: string): boolean {
    return !!this.env.get<string>(key);
  }

  lastChange(key: string): { updatedBy: string | null; updatedAt: Date } | null {
    const o = this.overrides.get(key);
    return o ? { updatedBy: o.updatedBy, updatedAt: o.updatedAt } : null;
  }

  /**
   * Save or clear overrides for one provider in one transaction, with an audit
   * row per key (never the value). `null` clears the override, so the env var
   * applies again. Callers validate which keys are allowed.
   */
  async save(provider: string, values: Record<string, string | null>, actor: string | null): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      for (const [key, value] of Object.entries(values)) {
        if (value === null) {
          const res = await m.delete(ProviderCredential, { key });
          if (res.affected) {
            await m.insert(ProviderCredentialChange, { key, provider, action: 'cleared', actor });
          }
        } else {
          await m.save(ProviderCredential, { key, provider, valueEnc: encryptSecret(value), updatedBy: actor });
          await m.insert(ProviderCredentialChange, { key, provider, action: 'set', actor });
        }
      }
    });
    await this.reload();
  }

  async reload(): Promise<void> {
    let rows: ProviderCredential[];
    try {
      rows = await this.rows.find();
    } catch (err) {
      this.logger.warn(`Could not read provider_credentials; using .env values only: ${errMsg(err)}`);
      return;
    }
    const next = new Map<string, { value: string; updatedBy: string | null; updatedAt: Date }>();
    for (const r of rows) {
      try {
        next.set(r.key, { value: decryptSecret(r.valueEnc), updatedBy: r.updatedBy ?? null, updatedAt: r.updatedAt });
      } catch (err) {
        // Wrong WEBHOOK_SECRET_ENCRYPTION_KEY or a corrupt row. Skip it so the
        // env value applies, and say which key so the operator can re-save it.
        this.logger.error(`Could not decrypt saved credential ${r.key}; falling back to .env: ${errMsg(err)}`);
      }
    }
    this.overrides = next;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
