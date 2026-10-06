import { XenditMode, xenditMode } from '../../common/xendit-mode';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Paged, toPaged } from '../../common/dto/pagination.dto';
import { App, AppConfigChange } from '../../database/entities';
import { ListConfigChangesDto, UpdateAppConfigDto } from './dto/merchant.dto';

export interface AppConfigView {
  appId: string;
  name: string;
  slug: string;
  /** `test` (Xendit test key: no real money) or `live`; `unknown` when the key is not set. */
  mode: XenditMode;
  /** The payment methods this app's checkouts offer (Xendit codes); null = every method. */
  paymentMethods: string[] | null;
  marketplace: {
    enabled: boolean;
    /** Default platform fee % for new payments. */
    feePercent: number | null;
    /** Range this app may set its own fee within; null = fee is operator-only. */
    feeBounds: { min: number; max: number } | null;
    /** Minor units. */
    minPayout: number;
  };
}

type ConfigField =
  | 'marketplace_enabled' | 'marketplace_fee_percent' | 'marketplace_min_payout'
  | 'marketplace_fee_min_percent' | 'marketplace_fee_max_percent';

/**
 * An app's marketplace config, readable + partly editable by the app itself
 * (GET/PATCH /v1/app/config), with every change — app or operator — recorded.
 *
 * Guardrail: an app may only move its fee inside the range the operator set
 * (marketplace_fee_min/max_percent). With no range set, the fee is operator-only.
 * Enabling marketplace mode and the range itself stay operator-only.
 */
@Injectable()
export class AppConfigService {
  constructor(
    @InjectRepository(App) private readonly apps: Repository<App>,
    @InjectRepository(AppConfigChange) private readonly changes: Repository<AppConfigChange>,
  ) {}

  view(app: App): AppConfigView {
    return {
      appId: app.id,
      name: app.name,
      slug: app.slug,
      // Test or live: whether money through this AcePay is real.
      mode: xenditMode(process.env['XENDIT_SECRET_KEY']),
      paymentMethods: app.paymentMethods ?? null,
      marketplace: {
        enabled: app.marketplaceEnabled,
        feePercent: app.marketplaceFeePercent ?? null,
        feeBounds: feeBounds(app),
        minPayout: app.marketplaceMinPayout,
      },
    };
  }

  async updateFromApp(app: App, dto: UpdateAppConfigDto, actorRef: string | null): Promise<AppConfigView> {
    if (!app.marketplaceEnabled) {
      throw new ForbiddenException({
        error: 'marketplace_not_enabled',
        message: 'Marketplace payments are not enabled for this app. Ask the AcePay operator to turn them on.',
      });
    }
    if (dto.feePercent === undefined && dto.minPayout === undefined) {
      throw new BadRequestException({ error: 'nothing_to_update', message: 'Send feePercent and/or minPayout' });
    }

    if (dto.feePercent !== undefined) {
      const bounds = feeBounds(app);
      if (!bounds) {
        throw new ForbiddenException({
          error: 'fee_change_not_allowed',
          message: "This app can't change its own fee. Ask the AcePay operator to set an allowed fee range first.",
        });
      }
      if (dto.feePercent < bounds.min || dto.feePercent > bounds.max) {
        throw new BadRequestException({
          error: 'fee_out_of_bounds',
          message: `Fee must be between ${bounds.min}% and ${bounds.max}%`,
          details: { min: bounds.min, max: bounds.max },
        });
      }
    }

    const before = snapshot(app);
    if (dto.feePercent !== undefined) app.marketplaceFeePercent = dto.feePercent;
    if (dto.minPayout !== undefined) app.marketplaceMinPayout = dto.minPayout;
    const saved = await this.apps.save(app);
    await this.record(saved.id, 'app', actorRef, before, snapshot(saved));
    return this.view(saved);
  }

  /** Writes one audit row per field whose value actually changed. */
  async record(
    appId: string,
    actor: 'admin' | 'app',
    actorRef: string | null,
    before: Partial<Record<ConfigField, unknown>>,
    after: Partial<Record<ConfigField, unknown>>,
  ): Promise<void> {
    const rows = (Object.keys(after) as ConfigField[])
      .filter((f) => (before[f] ?? null) !== (after[f] ?? null))
      .map((field) => this.changes.create({
        appId, actor, actorRef, field, oldValue: before[field] ?? null, newValue: after[field] ?? null,
      }));
    if (rows.length) await this.changes.save(rows);
  }

  async listChanges(q: ListConfigChangesDto): Promise<Paged<AppConfigChange>> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const [data, total] = await this.changes.findAndCount({
      where: q.appId ? { appId: q.appId } : {},
      relations: { app: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return toPaged(data, total, page, pageSize);
  }
}

export function feeBounds(app: App): { min: number; max: number } | null {
  if (app.marketplaceFeeMinPercent == null || app.marketplaceFeeMaxPercent == null) return null;
  return { min: Number(app.marketplaceFeeMinPercent), max: Number(app.marketplaceFeeMaxPercent) };
}

/** The audited fields, in comparable form. */
export function snapshot(app: App): Record<ConfigField, unknown> {
  return {
    marketplace_enabled: app.marketplaceEnabled,
    marketplace_fee_percent: app.marketplaceFeePercent ?? null,
    marketplace_min_payout: app.marketplaceMinPayout,
    marketplace_fee_min_percent: app.marketplaceFeeMinPercent ?? null,
    marketplace_fee_max_percent: app.marketplaceFeeMaxPercent ?? null,
  };
}
