import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MerchantStatus, PayoutStatus, TransactionStatus, TransactionType,
} from '../../common/enums';
import { App, Merchant, Payout, Transaction } from '../../database/entities';
import { XenditPlatformClient } from '../../payment-providers/xendit-platform.client';
import { AppConfigService, feeBounds, snapshot } from './app-config.service';
import { MarketplaceSettingsDto } from './dto/merchant.dto';
import { validateMarketplaceSettings } from './marketplace-defaults.service';

/** Operator-side marketplace config and reporting. */
@Injectable()
export class MarketplaceAdminService {
  constructor(
    @InjectRepository(App) private readonly apps: Repository<App>,
    @InjectRepository(Merchant) private readonly merchants: Repository<Merchant>,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(Payout) private readonly payouts: Repository<Payout>,
    private readonly xendit: XenditPlatformClient,
    private readonly appConfig: AppConfigService,
  ) {}

  /** Turns marketplace mode on/off for one app and sets its fee, minimum
   *  payout and the fee range the app may later choose within. Enabling
   *  requires a fee — there's no global default (BooklyPH is 12%). Every
   *  change is written to the config audit log. */
  async updateSettings(appId: string, dto: MarketplaceSettingsDto, adminEmail: string | null = null) {
    const app = await this.apps.findOne({ where: { id: appId } });
    if (!app) throw new NotFoundException({ error: 'app_not_found', message: `App ${appId} not found` });
    const before = snapshot(app);

    if (dto.feePercent !== undefined) app.marketplaceFeePercent = dto.feePercent;
    if (dto.minPayout !== undefined) app.marketplaceMinPayout = dto.minPayout;
    if (dto.feeMinPercent !== undefined) app.marketplaceFeeMinPercent = dto.feeMinPercent;
    if (dto.feeMaxPercent !== undefined) app.marketplaceFeeMaxPercent = dto.feeMaxPercent;

    validateMarketplaceSettings({
      enabled: dto.enabled,
      feePercent: app.marketplaceFeePercent ?? null,
      feeMinPercent: app.marketplaceFeeMinPercent ?? null,
      feeMaxPercent: app.marketplaceFeeMaxPercent ?? null,
    });
    app.marketplaceEnabled = dto.enabled;
    await this.apps.save(app);
    await this.appConfig.record(app.id, 'admin', adminEmail, before, snapshot(app));
    return this.settingsView(app);
  }

  async listSettings() {
    const apps = await this.apps.find({ order: { name: 'ASC' } });
    return { data: apps.map((a) => this.settingsView(a)) };
  }

  /** Per app: merchants by status, platform fees earned, money paid out. */
  async summary() {
    const apps = await this.apps.find({ where: { marketplaceEnabled: true }, order: { name: 'ASC' } });

    const merchantCounts = await this.merchants.createQueryBuilder('m')
      .select('m.app_id', 'appId').addSelect('m.status', 'status').addSelect('COUNT(*)', 'count')
      .groupBy('m.app_id').addGroupBy('m.status')
      .getRawMany<{ appId: string; status: MerchantStatus; count: string }>();

    // Fees on succeeded marketplace payments. Refunds don't return the fee
    // (Xendit doesn't reverse splits), so they aren't netted out here.
    const fees = await this.transactions.createQueryBuilder('t')
      .select('t.app_id', 'appId')
      .addSelect('t.currency', 'currency')
      .addSelect('COALESCE(SUM(t.platform_fee_amount), 0)', 'platformFees')
      .addSelect('COALESCE(SUM(t.amount), 0)', 'gross')
      .addSelect('COUNT(*)', 'payments')
      .where('t.merchant_id IS NOT NULL')
      .andWhere('t.type = :type', { type: TransactionType.Payment })
      .andWhere('t.status = :st', { st: TransactionStatus.Succeeded })
      .groupBy('t.app_id').addGroupBy('t.currency')
      .getRawMany<{ appId: string; currency: string; platformFees: string; gross: string; payments: string }>();

    const paid = await this.payouts.createQueryBuilder('p')
      .select('p.app_id', 'appId').addSelect('p.status', 'status').addSelect('COALESCE(SUM(p.amount), 0)', 'amount')
      .where('p.status IN (:...st)', { st: [PayoutStatus.Succeeded, PayoutStatus.Pending, PayoutStatus.Queued] })
      .groupBy('p.app_id').addGroupBy('p.status')
      .getRawMany<{ appId: string; status: PayoutStatus; amount: string }>();

    return {
      payoutFeeReserve: this.xendit.payoutFeeReserve(),
      apps: apps.map((a) => {
        const counts: Partial<Record<MerchantStatus, number>> = {};
        for (const r of merchantCounts.filter((r) => r.appId === a.id)) counts[r.status] = Number(r.count);
        const feeRows = fees.filter((r) => r.appId === a.id);
        const paidRows = paid.filter((r) => r.appId === a.id);
        return {
          ...this.settingsView(a),
          merchants: counts,
          revenue: feeRows.map((r) => ({
            currency: r.currency,
            gross: Number(r.gross),
            platformFees: Number(r.platformFees),
            payments: Number(r.payments),
          })),
          paidOut: Number(paidRows.find((r) => r.status === PayoutStatus.Succeeded)?.amount ?? 0),
          payoutsInFlight: paidRows
            .filter((r) => r.status !== PayoutStatus.Succeeded)
            .reduce((s, r) => s + Number(r.amount), 0),
        };
      }),
    };
  }

  listChannels(currency: string) {
    return this.xendit.listPayoutChannels(currency);
  }

  private settingsView(a: App) {
    return {
      appId: a.id,
      appName: a.name,
      appSlug: a.slug,
      marketplaceEnabled: a.marketplaceEnabled,
      feePercent: a.marketplaceFeePercent ?? null,
      feeBounds: feeBounds(a),
      minPayout: a.marketplaceMinPayout,
    };
  }
}
