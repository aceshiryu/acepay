import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { Paged, toPaged } from '../../common/dto/pagination.dto';
import { MerchantStatus, PayoutStatus } from '../../common/enums';
import { App, Merchant, Payout } from '../../database/entities';
import { XenditPlatformClient } from '../../payment-providers/xendit-platform.client';
import {
  CreateMerchantDto, ListMerchantsAdminDto, ListMerchantsAppDto, PayoutDestinationFields,
  UpdateMerchantAdminDto, UpdateMerchantAppDto,
} from './dto/merchant.dto';
import { ListPayoutsDto } from './dto/payout-run.dto';
import { MerchantEventsService } from './merchant-events.service';
import {
  effectiveFeePercent, maskAccount, MarketplaceFeeNotSetError, payoutDestinationHash,
} from './marketplace.util';

const PAYOUT_CURRENCY = 'PHP';

/** What apps see. The full account number never leaves AcePay via /v1. */
export interface MerchantView {
  id: string;
  externalRef: string;
  name: string;
  email: string;
  status: MerchantStatus;
  feePercent: number | null;
  feeOverridePercent: number | null;
  feeOverrideEndsAt: Date | null;
  payoutChannelCode: string | null;
  payoutAccount: string | null;
  payoutAccountHolderName: string | null;
  hasPayoutDestination: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MerchantBalance {
  merchantId: string;
  currency: string;
  /** Live sub-account balance, minor units. */
  available: number;
  /** What the next payout run would send (available − payout-fee reserve), never negative. */
  payable: number;
  /** Payouts already queued / in flight, minor units. */
  inFlight: number;
  minPayout: number;
}

@Injectable()
export class MerchantsService {
  constructor(
    @InjectRepository(Merchant) private readonly merchants: Repository<Merchant>,
    @InjectRepository(Payout) private readonly payouts: Repository<Payout>,
    @InjectRepository(App) private readonly apps: Repository<App>,
    private readonly xendit: XenditPlatformClient,
    private readonly events: MerchantEventsService,
  ) {}

  // ─── App-facing (/v1/merchants) — always scoped to the calling app ─────

  requireMarketplace(app: App): void {
    if (!app.marketplaceEnabled) {
      throw new ForbiddenException({
        error: 'marketplace_not_enabled',
        message: 'Marketplace payments are not enabled for this app. Ask the AcePay operator to turn them on.',
      });
    }
  }

  async create(app: App, dto: CreateMerchantDto): Promise<MerchantView> {
    this.requireMarketplace(app);
    const destination = resolveDestination(dto, null);

    const existing = await this.merchants.findOne({ where: { appId: app.id, externalRef: dto.externalRef } });
    if (existing) {
      throw new ConflictException({
        error: 'merchant_exists',
        message: `A merchant with externalRef "${dto.externalRef}" already exists for this app`,
        details: { merchantId: existing.id },
      });
    }

    // Claim (app, externalRef) first so two concurrent creates can't both make
    // a Xendit sub-account; the unique constraint rejects the second insert.
    let merchant = this.merchants.create({
      appId: app.id,
      externalRef: dto.externalRef,
      name: dto.name,
      email: dto.email,
      status: MerchantStatus.Pending,
      metadata: dto.metadata ?? {},
      ...destination,
    });
    try {
      merchant = await this.merchants.save(merchant);
    } catch (err) {
      const winner = await this.merchants.findOne({ where: { appId: app.id, externalRef: dto.externalRef } });
      if (winner) {
        throw new ConflictException({
          error: 'merchant_exists',
          message: `A merchant with externalRef "${dto.externalRef}" already exists for this app`,
          details: { merchantId: winner.id },
        });
      }
      throw err;
    }

    try {
      await this.provisionSubAccount(merchant);
    } catch (err) {
      // No sub-account → no merchant. Remove the claim so the app can retry
      // with the same externalRef.
      await this.merchants.delete({ id: merchant.id });
      throw err;
    }
    return this.toView(merchant, app);
  }

  async list(app: App, q: ListMerchantsAppDto): Promise<Paged<MerchantView>> {
    const qb = this.merchants.createQueryBuilder('m').where('m.app_id = :appId', { appId: app.id });
    if (q.externalRef) qb.andWhere('m.external_ref = :ref', { ref: q.externalRef });
    if (q.status) qb.andWhere('m.status = :status', { status: q.status });
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    qb.orderBy('m.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize);
    const [rows, total] = await qb.getManyAndCount();
    return toPaged(rows.map((m) => this.toView(m, app)), total, page, pageSize);
  }

  /** Tenant boundary: another app's merchant is a plain 404. */
  async findOwned(app: App, id: string): Promise<Merchant> {
    const merchant = await this.merchants.findOne({ where: { id, appId: app.id } });
    if (!merchant) {
      throw new NotFoundException({ error: 'merchant_not_found', message: `Merchant ${id} not found` });
    }
    return merchant;
  }

  async findOne(app: App, id: string): Promise<MerchantView> {
    return this.toView(await this.findOwned(app, id), app);
  }

  async update(app: App, id: string, dto: UpdateMerchantAppDto): Promise<MerchantView> {
    const merchant = await this.findOwned(app, id);
    applyProfileUpdate(merchant, dto);
    return this.toView(await this.merchants.save(merchant), app);
  }

  async balance(app: App, id: string): Promise<MerchantBalance> {
    return this.readBalance(await this.findOwned(app, id), app);
  }

  async listPayouts(app: App, id: string, q: ListPayoutsDto): Promise<Paged<PayoutView>> {
    const merchant = await this.findOwned(app, id);
    return this.pagedPayouts(merchant.id, q, true);
  }

  // ─── Admin ───────────────────────────────────────────────────────────

  async adminList(q: ListMerchantsAdminDto): Promise<Paged<Record<string, unknown>>> {
    const qb = this.merchants.createQueryBuilder('m').leftJoinAndSelect('m.app', 'app');
    if (q.appId) qb.andWhere('m.app_id = :appId', { appId: q.appId });
    if (q.status) qb.andWhere('m.status = :status', { status: q.status });
    if (q.externalRef) qb.andWhere('m.external_ref = :ref', { ref: q.externalRef });
    if (q.search) {
      qb.andWhere('(m.name ILIKE :s OR m.email ILIKE :s OR m.external_ref ILIKE :s)', { s: `%${q.search}%` });
    }
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    qb.orderBy('m.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize);
    const [rows, total] = await qb.getManyAndCount();

    // Same payout destination on other merchants: flag within an app (possible
    // duplicate or abuse), inform across apps (same person, two apps — fine).
    const hashes = [...new Set(rows.map((m) => m.payoutDestinationHash).filter((h): h is string => !!h))];
    const sharing = hashes.length
      ? await this.merchants.find({
          where: { payoutDestinationHash: In(hashes) },
          select: { id: true, appId: true, payoutDestinationHash: true },
        })
      : [];

    const data = rows.map((m) => {
      const others = sharing.filter((o) => o.payoutDestinationHash === m.payoutDestinationHash && o.id !== m.id);
      return {
        ...this.adminView(m),
        duplicateDestinationInApp: others.some((o) => o.appId === m.appId),
        sharedDestinationOtherApps: new Set(others.filter((o) => o.appId !== m.appId).map((o) => o.appId)).size,
      };
    });
    return toPaged(data, total, page, pageSize);
  }

  async adminFindOne(id: string): Promise<Record<string, unknown>> {
    const merchant = await this.adminGet(id);
    const sharedWith = merchant.payoutDestinationHash
      ? await this.merchants.find({
          where: { payoutDestinationHash: merchant.payoutDestinationHash, id: Not(merchant.id) },
          relations: { app: true },
        })
      : [];
    return {
      ...this.adminView(merchant),
      payoutAccountNumber: merchant.payoutAccountNumber ?? null,
      sharedWith: sharedWith.map((o) => ({
        merchantId: o.id,
        name: o.name,
        appId: o.appId,
        appName: o.app?.name ?? null,
        sameApp: o.appId === merchant.appId,
      })),
    };
  }

  async adminUpdate(id: string, dto: UpdateMerchantAdminDto): Promise<Record<string, unknown>> {
    const merchant = await this.adminGet(id);
    applyProfileUpdate(merchant, dto);

    if (dto.status !== undefined && dto.status !== merchant.status) {
      const allowed =
        (merchant.status === MerchantStatus.Active && dto.status === MerchantStatus.Paused) ||
        (merchant.status === MerchantStatus.Paused && dto.status === MerchantStatus.Active);
      if (!allowed) {
        throw new BadRequestException({
          error: 'invalid_status_change',
          message: `Can't change a ${merchant.status} merchant to ${dto.status}. Only active ↔ paused is operator-controlled.`,
        });
      }
      merchant.status = dto.status;
    }
    if (dto.feeOverridePercent !== undefined) merchant.feeOverridePercent = dto.feeOverridePercent;
    if (dto.feeOverrideEndsAt !== undefined) {
      merchant.feeOverrideEndsAt = dto.feeOverrideEndsAt ? new Date(dto.feeOverrideEndsAt) : null;
    }
    if (merchant.feeOverridePercent == null) merchant.feeOverrideEndsAt = null;
    await this.merchants.save(merchant);
    return this.adminFindOne(id);
  }

  async adminBalance(id: string): Promise<MerchantBalance> {
    const merchant = await this.adminGet(id);
    return this.readBalance(merchant, merchant.app ?? (await this.apps.findOneByOrFail({ id: merchant.appId })));
  }

  async adminPayouts(id: string, q: ListPayoutsDto): Promise<Paged<PayoutView>> {
    const merchant = await this.adminGet(id);
    return this.pagedPayouts(merchant.id, q, false);
  }

  /** Re-checks the sub-account on Xendit — or creates it, if creation failed earlier. */
  async syncAccount(id: string): Promise<Record<string, unknown>> {
    const merchant = await this.adminGet(id);
    if (!merchant.xenditAccountId) {
      await this.provisionSubAccount(merchant);
    } else {
      const acct = await this.xendit.getAccount(merchant.xenditAccountId);
      await this.applyAccountStatus(merchant, acct.status, acct.raw);
    }
    return this.adminFindOne(id);
  }

  /**
   * Maps a Xendit account status onto the merchant. Shared by the
   * account.* webhook and the manual sync. Operator pauses are preserved:
   * a LIVE update never un-pauses a paused merchant.
   */
  async applyAccountStatus(merchant: Merchant, providerStatus: string, raw: Record<string, unknown> = {}): Promise<void> {
    const status = providerStatus.toUpperCase();
    merchant.xenditAccountStatus = status || merchant.xenditAccountStatus || null;
    const before = merchant.status;
    if (status === 'LIVE' && (before === MerchantStatus.Pending || before === MerchantStatus.Suspended)) {
      merchant.status = MerchantStatus.Active;
    } else if (status === 'SUSPENDED' && before !== MerchantStatus.Suspended) {
      merchant.status = MerchantStatus.Suspended;
    }
    await this.merchants.save(merchant);

    if (before !== MerchantStatus.Active && merchant.status === MerchantStatus.Active) {
      await this.events.emit('merchant.activated', merchant, { eventKey: `${merchant.id}_${Date.now()}`, raw });
    } else if (before !== MerchantStatus.Suspended && merchant.status === MerchantStatus.Suspended) {
      await this.events.emit('merchant.suspended', merchant, { eventKey: `${merchant.id}_${Date.now()}`, raw });
    }
  }

  // ─── internals ───────────────────────────────────────────────────────

  private async provisionSubAccount(merchant: Merchant): Promise<void> {
    const acct = await this.xendit.createOwnedAccount({ email: merchant.email, businessName: merchant.name });
    merchant.xenditAccountId = acct.id;
    merchant.xenditAccountStatus = acct.status || null;
    // OWNED accounts usually come back LIVE straight away; otherwise the
    // account.created webhook (or an admin sync) activates the merchant.
    if (acct.status === 'LIVE') merchant.status = MerchantStatus.Active;
    await this.merchants.save(merchant);
  }

  private async adminGet(id: string): Promise<Merchant> {
    const merchant = await this.merchants.findOne({ where: { id }, relations: { app: true } });
    if (!merchant) {
      throw new NotFoundException({ error: 'merchant_not_found', message: `Merchant ${id} not found` });
    }
    return merchant;
  }

  private async readBalance(merchant: Merchant, app: App): Promise<MerchantBalance> {
    if (!merchant.xenditAccountId) {
      throw new BadRequestException({ error: 'no_sub_account', message: 'This merchant has no Xendit sub-account yet' });
    }
    const available = await this.xendit.getBalance(merchant.xenditAccountId, PAYOUT_CURRENCY);
    const inFlightRow = await this.payouts.createQueryBuilder('p')
      .select('COALESCE(SUM(p.amount), 0)', 'sum')
      .where('p.merchant_id = :id', { id: merchant.id })
      .andWhere('p.status IN (:...st)', { st: [PayoutStatus.Queued, PayoutStatus.Pending] })
      .getRawOne<{ sum: string }>();
    return {
      merchantId: merchant.id,
      currency: PAYOUT_CURRENCY,
      available,
      payable: Math.max(0, available - this.xendit.payoutFeeReserve()),
      inFlight: Number(inFlightRow?.sum ?? 0) || 0,
      minPayout: app.marketplaceMinPayout,
    };
  }

  private async pagedPayouts(merchantId: string, q: ListPayoutsDto, mask: boolean): Promise<Paged<PayoutView>> {
    const qb = this.payouts.createQueryBuilder('p').where('p.merchant_id = :id', { id: merchantId });
    if (q.status) qb.andWhere('p.status = :status', { status: q.status });
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    qb.orderBy('p.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize);
    const [rows, total] = await qb.getManyAndCount();
    return toPaged(rows.map((p) => payoutView(p, mask)), total, page, pageSize);
  }

  toView(m: Merchant, app: App): MerchantView {
    let feePercent: number | null = null;
    try {
      feePercent = effectiveFeePercent(app, m);
    } catch (err) {
      if (!(err instanceof MarketplaceFeeNotSetError)) throw err;
    }
    return {
      id: m.id,
      externalRef: m.externalRef,
      name: m.name,
      email: m.email,
      status: m.status,
      feePercent,
      feeOverridePercent: m.feeOverridePercent ?? null,
      feeOverrideEndsAt: m.feeOverrideEndsAt ?? null,
      payoutChannelCode: m.payoutChannelCode ?? null,
      payoutAccount: maskAccount(m.payoutAccountNumber),
      payoutAccountHolderName: m.payoutAccountHolderName ?? null,
      hasPayoutDestination: !!(m.payoutChannelCode && m.payoutAccountNumber && m.payoutAccountHolderName),
      metadata: m.metadata ?? {},
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  }

  private adminView(m: Merchant) {
    return {
      ...(m.app ? this.toView(m, m.app) : {}),
      id: m.id,
      appId: m.appId,
      appName: m.app?.name ?? null,
      xenditAccountId: m.xenditAccountId ?? null,
      xenditAccountStatus: m.xenditAccountStatus ?? null,
    };
  }
}

/** Destination fields are all-or-nothing: a half-filled destination would
 *  send money to an account with no name or no number. */
function resolveDestination(
  dto: PayoutDestinationFields,
  current: Merchant | null,
): Partial<Pick<Merchant, 'payoutChannelCode' | 'payoutAccountNumber' | 'payoutAccountHolderName' | 'payoutDestinationHash'>> {
  const touched = dto.payoutChannelCode !== undefined
    || dto.payoutAccountNumber !== undefined
    || dto.payoutAccountHolderName !== undefined;
  if (!touched) return {};
  const channel = dto.payoutChannelCode ?? current?.payoutChannelCode ?? null;
  const account = dto.payoutAccountNumber ?? current?.payoutAccountNumber ?? null;
  const holder = dto.payoutAccountHolderName ?? current?.payoutAccountHolderName ?? null;
  if (!channel || !account || !holder) {
    throw new BadRequestException({
      error: 'incomplete_payout_destination',
      message: 'payoutChannelCode, payoutAccountNumber and payoutAccountHolderName must all be set together',
    });
  }
  return {
    payoutChannelCode: channel.toUpperCase(),
    payoutAccountNumber: account.trim(),
    payoutAccountHolderName: holder.trim(),
    payoutDestinationHash: payoutDestinationHash(channel, account),
  };
}

function applyProfileUpdate(merchant: Merchant, dto: UpdateMerchantAppDto): void {
  Object.assign(merchant, resolveDestination(dto, merchant));
  if (dto.name !== undefined) merchant.name = dto.name;
  if (dto.email !== undefined) merchant.email = dto.email;
  if (dto.metadata !== undefined) merchant.metadata = dto.metadata;
}

export interface PayoutView {
  id: string;
  runId: string | null;
  merchantId: string;
  appId: string;
  amount: number;
  currency: string;
  status: Payout['status'];
  providerStatus: string | null;
  channelCode: string | null;
  accountNumber: string | null;
  accountHolderName: string | null;
  xenditPayoutId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  retryOf: string | null;
  estimatedArrivalAt: Date | null;
  sentAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export function payoutView(p: Payout, mask: boolean): PayoutView {
  return {
    id: p.id,
    runId: p.runId ?? null,
    merchantId: p.merchantId,
    appId: p.appId,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    providerStatus: p.providerStatus ?? null,
    channelCode: p.channelCode ?? null,
    accountNumber: mask ? maskAccount(p.accountNumber) : p.accountNumber ?? null,
    accountHolderName: p.accountHolderName ?? null,
    xenditPayoutId: p.xenditPayoutId ?? null,
    failureCode: p.failureCode ?? null,
    failureMessage: p.failureMessage ?? null,
    retryOf: p.retryOf ?? null,
    estimatedArrivalAt: p.estimatedArrivalAt ?? null,
    sentAt: p.sentAt ?? null,
    completedAt: p.completedAt ?? null,
    createdAt: p.createdAt,
  };
}
