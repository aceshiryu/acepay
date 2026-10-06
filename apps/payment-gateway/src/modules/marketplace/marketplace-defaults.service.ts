import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { App, PlatformSetting } from '../../database/entities';
import { MarketplaceSettingsDto } from './dto/merchant.dto';

export const MARKETPLACE_DEFAULTS_KEY = 'marketplace_defaults';

/** What a newly registered app starts with. Copied onto the app at creation. */
export interface MarketplaceDefaults {
  enabled: boolean;
  feePercent: number | null;
  feeMinPercent: number | null;
  feeMaxPercent: number | null;
  /** Minor units. */
  minPayout: number;
}

/** Used when the settings row is missing (e.g. migration not run yet): safe and off. */
export const FALLBACK_DEFAULTS: MarketplaceDefaults = {
  enabled: false, feePercent: null, feeMinPercent: null, feeMaxPercent: null, minPayout: 50000,
};

/**
 * Operator-managed defaults for new apps' marketplace settings. They are a
 * starting point, not a live global: each app gets its own copy when it's
 * registered, and changing the defaults later never touches existing apps
 * (BooklyPH keeps its 12% whatever the defaults become).
 */
@Injectable()
export class MarketplaceDefaultsService {
  constructor(
    @InjectRepository(PlatformSetting) private readonly settings: Repository<PlatformSetting>,
  ) {}

  async get(): Promise<MarketplaceDefaults & { updatedBy: string | null; updatedAt: Date | null }> {
    const row = await this.settings.findOne({ where: { key: MARKETPLACE_DEFAULTS_KEY } });
    return {
      ...normalize(row?.value),
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async update(dto: MarketplaceSettingsDto, adminEmail: string | null) {
    const current = normalize((await this.settings.findOne({ where: { key: MARKETPLACE_DEFAULTS_KEY } }))?.value);
    const next: MarketplaceDefaults = {
      enabled: dto.enabled,
      feePercent: dto.feePercent !== undefined ? dto.feePercent : current.feePercent,
      feeMinPercent: dto.feeMinPercent !== undefined ? dto.feeMinPercent : current.feeMinPercent,
      feeMaxPercent: dto.feeMaxPercent !== undefined ? dto.feeMaxPercent : current.feeMaxPercent,
      minPayout: dto.minPayout ?? current.minPayout,
    };
    validateMarketplaceSettings(next);
    await this.settings.save({ key: MARKETPLACE_DEFAULTS_KEY, value: { ...next }, updatedBy: adminEmail });
    return this.get();
  }

  /** The App columns a new app should start with. */
  async appFields(): Promise<Pick<App,
    'marketplaceEnabled' | 'marketplaceFeePercent' | 'marketplaceFeeMinPercent' | 'marketplaceFeeMaxPercent' | 'marketplaceMinPayout'
  >> {
    const d = await this.get();
    return {
      // Never start "on" without a fee, even if the stored defaults are odd.
      marketplaceEnabled: d.enabled && d.feePercent != null,
      marketplaceFeePercent: d.feePercent,
      marketplaceFeeMinPercent: d.feeMinPercent,
      marketplaceFeeMaxPercent: d.feeMaxPercent,
      marketplaceMinPayout: d.minPayout,
    };
  }
}

/** Same rules for an app's settings and for the defaults. */
export function validateMarketplaceSettings(s: {
  enabled: boolean; feePercent: number | null; feeMinPercent: number | null; feeMaxPercent: number | null;
}): void {
  const hasMin = s.feeMinPercent != null;
  const hasMax = s.feeMaxPercent != null;
  if (hasMin !== hasMax) {
    throw new BadRequestException({
      error: 'fee_bounds_incomplete',
      message: 'Set both the lowest and highest allowed fee, or clear both',
    });
  }
  if (hasMin && Number(s.feeMinPercent) > Number(s.feeMaxPercent)) {
    throw new BadRequestException({ error: 'fee_bounds_invalid', message: 'Lowest allowed fee is above the highest' });
  }
  if (s.enabled && s.feePercent == null) {
    throw new BadRequestException({
      error: 'marketplace_fee_required',
      message: 'Set a platform fee % before enabling marketplace payments',
    });
  }
}

function normalize(v: Record<string, unknown> | undefined | null): MarketplaceDefaults {
  if (!v) return { ...FALLBACK_DEFAULTS };
  const num = (x: unknown): number | null => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
  const minPayout = num(v.minPayout);
  return {
    enabled: v.enabled === true,
    feePercent: num(v.feePercent),
    feeMinPercent: num(v.feeMinPercent),
    feeMaxPercent: num(v.feeMaxPercent),
    minPayout: minPayout != null && Number.isInteger(minPayout) && minPayout >= 0 ? minPayout : FALLBACK_DEFAULTS.minPayout,
  };
}
