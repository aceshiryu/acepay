import {
  BadRequestException, ConflictException, Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LogAction, LogActor, MerchantStatus, Provider, TransactionStatus, TransactionType,
} from '../../common/enums';
import { TransactionLoggerService } from '../../common/services/transaction-logger.service';
import { App, Transaction } from '../../database/entities';
import { XenditPlatformClient } from '../../payment-providers/xendit-platform.client';
import { CreateMarketplacePaymentDto } from './dto/marketplace-payment.dto';
import { MerchantsService } from './merchants.service';
import {
  effectiveFeePercent, MarketplaceFeeNotSetError, splitAmount,
} from './marketplace.util';
import { SplitRulesService } from './split-rules.service';

export interface MarketplacePaymentView {
  id: string;
  status: TransactionStatus;
  amount: number;
  currency: string;
  merchantId: string;
  /** Platform's cut, minor units (before Xendit's fees). */
  platformFee: number;
  /** amount − platformFee; Xendit's payment fee then comes out of this. */
  merchantAmount: number;
  feePercent: number;
  checkoutUrl: string | null;
  idempotencyKey: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/**
 * POST /v1/payments for marketplace apps: a one-time payment collected FOR a
 * merchant. The Xendit invoice is created on the merchant's sub-account (so
 * Xendit's payment fee comes out of the merchant's side) with a split rule
 * that routes the app's platform fee to the master account when it settles.
 */
@Injectable()
export class MarketplacePaymentsService {
  constructor(
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    private readonly merchants: MerchantsService,
    private readonly splitRules: SplitRulesService,
    private readonly xendit: XenditPlatformClient,
    private readonly txLogger: TransactionLoggerService,
  ) {}

  async create(app: App, dto: CreateMarketplacePaymentDto): Promise<MarketplacePaymentView> {
    this.merchants.requireMarketplace(app);

    const replay = await this.findReplay(app, dto);
    if (replay) return replay;

    const merchant = await this.merchants.findOwned(app, dto.merchantId);
    if (merchant.status !== MerchantStatus.Active || !merchant.xenditAccountId) {
      throw new BadRequestException({
        error: 'merchant_not_active',
        message: `Merchant ${merchant.id} is ${merchant.status} and can't accept payments`,
      });
    }

    let feePercent: number;
    try {
      feePercent = effectiveFeePercent(app, merchant);
    } catch (err) {
      if (err instanceof MarketplaceFeeNotSetError) {
        throw new BadRequestException({ error: 'marketplace_fee_not_set', message: err.message });
      }
      throw err;
    }
    const { platformFee, merchantAmount } = splitAmount(dto.amount, feePercent);
    const currency = dto.currency.toUpperCase();
    // A 0% rate needs no split at all.
    const splitRuleId = feePercent > 0 ? await this.splitRules.getOrCreate(feePercent, currency) : null;

    let tx = this.transactions.create({
      appId: app.id,
      provider: Provider.Xendit,
      type: TransactionType.Payment,
      status: TransactionStatus.Pending,
      amount: dto.amount,
      currency,
      description: dto.description ?? `Payment to ${merchant.name}`,
      metadata: dto.metadata ?? {},
      idempotencyKey: dto.idempotencyKey,
      redirectSuccess: dto.redirect.success,
      redirectFailed: dto.redirect.failed,
      merchantId: merchant.id,
      providerAccountId: merchant.xenditAccountId,
      platformFeePercent: feePercent,
      platformFeeAmount: platformFee,
      merchantAmount,
      splitRuleId,
      splitStatus: splitRuleId ? 'pending' : null,
    });
    try {
      tx = await this.transactions.save(tx);
    } catch (err) {
      // Same idempotency key raced in from a retry: hand back the winner.
      const winner = await this.findReplay(app, dto);
      if (winner) return winner;
      throw err;
    }
    await this.txLogger.log({
      transaction: tx, action: LogAction.PaymentCreated, actor: LogActor.App,
      statusTo: tx.status, details: { merchantId: merchant.id, feePercent, platformFee },
    });

    let invoice;
    try {
      invoice = await this.xendit.createSplitInvoice({
        forUserId: merchant.xenditAccountId,
        splitRuleId,
        externalId: tx.id,
        amount: dto.amount,
        currency,
        description: tx.description ?? `Payment to ${merchant.name}`,
        payerEmail: dto.customer?.email ?? null,
        successRedirectUrl: dto.redirect.success,
        failureRedirectUrl: dto.redirect.failed,
        metadata: {
          acepay_tx: tx.id,
          app_slug: app.slug,
          acepay_merchant: merchant.id,
        },
      });
    } catch (err) {
      tx.status = TransactionStatus.Failed;
      tx.splitStatus = null;
      await this.transactions.save(tx);
      throw err;
    }

    tx.providerTxId = invoice.id;
    tx.checkoutUrl = invoice.invoiceUrl;
    tx.providerCreatedAt = invoice.created;
    tx = await this.transactions.save(tx);
    await this.txLogger.log({
      transaction: tx, action: LogAction.PaymentProviderSent, actor: LogActor.System,
      statusFrom: tx.status, statusTo: tx.status, details: { invoiceId: invoice.id },
    });
    return toView(tx);
  }

  /** Same key on the same app returns the original payment — but only if it's
   *  really the same request; reusing a key for a different charge is a bug. */
  private async findReplay(app: App, dto: CreateMarketplacePaymentDto): Promise<MarketplacePaymentView | null> {
    const existing = await this.transactions.findOne({
      where: { appId: app.id, idempotencyKey: dto.idempotencyKey },
    });
    if (!existing) return null;
    if (existing.merchantId !== dto.merchantId || existing.amount !== dto.amount) {
      throw new ConflictException({
        error: 'idempotency_key_reused',
        message: 'This idempotencyKey was already used for a different payment',
        details: { transactionId: existing.id },
      });
    }
    return toView(existing);
  }
}

export function toView(tx: Transaction): MarketplacePaymentView {
  return {
    id: tx.id,
    status: tx.status,
    amount: tx.amount,
    currency: tx.currency,
    merchantId: tx.merchantId ?? '',
    platformFee: tx.platformFeeAmount ?? 0,
    merchantAmount: tx.merchantAmount ?? tx.amount,
    feePercent: tx.platformFeePercent ?? 0,
    checkoutUrl: tx.checkoutUrl ?? null,
    idempotencyKey: tx.idempotencyKey ?? null,
    metadata: tx.metadata ?? {},
    createdAt: tx.createdAt,
  };
}
