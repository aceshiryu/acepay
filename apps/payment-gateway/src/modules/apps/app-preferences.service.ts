import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Provider } from '../../common/enums';
import { PlatformSetting } from '../../database/entities/platform-setting.entity';

/**
 * Admin-only, per-app preferences, kept in the `platform_settings` key/value
 * table under `app_admin:<appId>` so no schema change is needed:
 *
 * - `provider`: the provider the app was added under. Apps have no provider
 *   column, and an app that charges without plans (e.g. Xendit marketplace)
 *   has nothing else to derive it from.
 * - `hiddenMenus`: inner-sidebar items the operator switched off for this app.
 */
export interface AppPreferences {
  provider: Provider | null;
  hiddenMenus: string[];
}

/** Inner-sidebar items that can be hidden. Overview and App settings always show. */
export const HIDEABLE_MENUS = [
  'payments', 'subscriptions', 'invoices', 'plans', 'customers', 'refunds',
  'payment-methods', 'merchants', 'payouts', 'webhooks', 'logs',
] as const;

const EMPTY: AppPreferences = { provider: null, hiddenMenus: [] };

export const appPrefsKey = (appId: string) => `app_admin:${appId}`;

function parse(value: Record<string, unknown> | undefined | null): AppPreferences {
  if (!value) return { ...EMPTY };
  const provider = Object.values(Provider).includes(value.provider as Provider) ? (value.provider as Provider) : null;
  const hiddenMenus = Array.isArray(value.hiddenMenus)
    ? (value.hiddenMenus as unknown[]).filter((m): m is string => typeof m === 'string' && (HIDEABLE_MENUS as readonly string[]).includes(m))
    : [];
  return { provider, hiddenMenus };
}

@Injectable()
export class AppPreferencesService {
  constructor(
    @InjectRepository(PlatformSetting) private readonly settings: Repository<PlatformSetting>,
  ) {}

  async get(appId: string): Promise<AppPreferences> {
    const row = await this.settings.findOne({ where: { key: appPrefsKey(appId) } });
    return parse(row?.value);
  }

  async getMany(appIds: string[]): Promise<Map<string, AppPreferences>> {
    const out = new Map<string, AppPreferences>();
    if (appIds.length === 0) return out;
    const rows = await this.settings.find({ where: { key: In(appIds.map(appPrefsKey)) } });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    for (const id of appIds) out.set(id, parse(byKey.get(appPrefsKey(id))));
    return out;
  }

  /** Merge `patch` into the app's preferences. Pass `manager` to join a transaction. */
  async set(appId: string, patch: Partial<AppPreferences>, actor: string | null, manager?: EntityManager): Promise<AppPreferences> {
    if (patch.hiddenMenus) {
      const bad = patch.hiddenMenus.filter((m) => !(HIDEABLE_MENUS as readonly string[]).includes(m));
      if (bad.length) {
        throw new BadRequestException({ error: 'unknown_menu', message: `Unknown menu item(s): ${bad.join(', ')}` });
      }
    }
    const repo = manager ? manager.getRepository(PlatformSetting) : this.settings;
    const current = parse((await repo.findOne({ where: { key: appPrefsKey(appId) } }))?.value);
    const next: AppPreferences = {
      provider: patch.provider !== undefined ? patch.provider : current.provider,
      hiddenMenus: patch.hiddenMenus !== undefined ? [...new Set(patch.hiddenMenus)] : current.hiddenMenus,
    };
    await repo.save({ key: appPrefsKey(appId), value: { ...next }, updatedBy: actor });
    return next;
  }
}
