import {
  BadRequestException, ConflictException, Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LogAction, LogActor, Provider, TransactionStatus, TransactionType,
} from '../../common/enums';
import { TransactionLoggerService } from '../../common/services/transaction-logger.service';
import { App, Transaction } from '../../database/entities';
import { ProviderRegistry } from '../../payment-providers/provider.registry';
import { AppStatusService } from '../apps/app-status.service';
import { CreateMarketplacePaymentDto } from '../marketplace/dto/marketplace-payment.dto';

/** Providers whose adapters can take a plain one-time payment through AcePay. */
export const ONE_TIME_PROVIDERS: readonly Provider[] = [Provider.Paymongo];

export interface OneTimePaymentView {
  id: string;
  code: string;
  status: TransactionStatus;
  provider: Provider;
  amount: number;
  currency: string;
  checkoutUrl: string | null;
  idempotencyKey: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/**
 * POST /v1/payments for apps that are not in marketplace mode: a plain
 * one-time charge on the app's provider (PayMongo Checkout for now). The
 * transaction row is created first, so a provider failure still leaves a
 * Failed row behind; the provider's paid / refunded webhooks then move it on
 * through the normal payment-event path in WebhooksService.
 */
@Injectable()
export class OneTimePaymentsService {
  constructor(
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    private readonly providers: ProviderRegistry,
    private readonly appStatus: AppStatusService,
    private readonly txLogger: TransactionLoggerService,
  ) {}

  async create(app: App, dto: CreateMarketplacePaymentDto): Promise<OneTimePaymentView> {
    const existing = await this.findExisting(app, dto);
    if (existing && !isRetryable(existing)) return toView(existing);

    const provider = existing?.provider ?? (await this.providerFor(app));

    if (existing) {
      existing.status = TransactionStatus.Pending;
      const retried = await this.transactions.save(existing);
      await this.txLogger.log({
        transaction: retried, action: LogAction.PaymentCreated, actor: LogActor.App,
        statusFrom: TransactionStatus.Failed, statusTo: retried.status, details: { retry: true },
      });
      return this.send(app, retried, dto);
    }

    let tx = this.transactions.create({
      appId: app.id,
      provider,
      type: TransactionType.Payment,
      status: TransactionStatus.Pending,
      amount: dto.amount,
      currency: dto.currency.toUpperCase(),
      description: dto.description ?? `Payment to ${app.name}`,
      metadata: dto.metadata ?? {},
      idempotencyKey: dto.idempotencyKey,
      redirectSuccess: dto.redirect.success,
      redirectFailed: dto.redirect.failed,
    });
    try {
      tx = await this.transactions.save(tx);
    } catch (err) {
      // Same idempotency key raced in from a retry: hand back the winner.
      const winner = await this.findExisting(app, dto);
      if (winner) return toView(winner);
      throw err;
    }
    await this.txLogger.log({
      transaction: tx, action: LogAction.PaymentCreated, actor: LogActor.App,
      statusTo: tx.status, details: { provider },
    });
    return this.send(app, tx, dto);
  }

  /** The app's provider, if it can take one-time payments. */
  private async providerFor(app: App): Promise<Provider> {
    const providers = (await this.appStatus.providersFor([app.id])).get(app.id) ?? [];
    const provider = providers.find((p) => ONE_TIME_PROVIDERS.includes(p));
    if (!provider) {
      throw new BadRequestException({
        error: 'one_time_not_supported',
        message: providers.length
          ? `One-time payments aren't available for ${providers.join(', ')} apps yet — only PayMongo`
          : "This app has no provider yet, so it can't take payments",
      });
    }
    return provider;
  }

  private async send(app: App, tx: Transaction, dto: CreateMarketplacePaymentDto): Promise<OneTimePaymentView> {
    let result;
    try {
      result = await this.providers.resolve(tx.provider).createPayment({
        acepayTxId: tx.id,
        appSlug: app.slug,
        amount: tx.amount,
        currency: tx.currency,
        description: tx.description ?? undefined,
        redirect: { success: dto.redirect.success, failed: dto.redirect.failed },
        metadata: dto.metadata ?? {},
        customer: dto.customer,
      });
    } catch (err) {
      tx.status = TransactionStatus.Failed;
      await this.transactions.save(tx);
      await this.txLogger.log({
        transaction: tx, action: LogAction.PaymentFailed, actor: LogActor.System,
        statusFrom: TransactionStatus.Pending, statusTo: TransactionStatus.Failed,
        details: { stage: 'provider_send', error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }

    tx.providerTxId = result.providerTxId;
    tx.checkoutUrl = result.checkoutUrl;
    tx.providerCreatedAt = result.providerCreatedAt;
    tx = await this.transactions.save(tx);
    await this.txLogger.log({
      transaction: tx, action: LogAction.PaymentProviderSent, actor: LogActor.System,
      statusFrom: tx.status, statusTo: tx.status, details: { providerTxId: result.providerTxId },
    });
    return toView(tx);
  }

  /** Same key on the same app finds the original payment — but only if it's
   *  really the same request; reusing a key for a different charge is a bug. */
  private async findExisting(app: App, dto: CreateMarketplacePaymentDto): Promise<Transaction | null> {
    const existing = await this.transactions.findOne({
      where: { appId: app.id, idempotencyKey: dto.idempotencyKey },
    });
    if (!existing) return null;
    if (existing.amount !== dto.amount || existing.merchantId) {
      throw new ConflictException({
        error: 'idempotency_key_reused',
        message: 'This idempotencyKey was already used for a different payment',
        details: { transactionId: existing.id },
      });
    }
    return existing;
  }
}

/** Failed before the provider made a checkout: a retry should try again. */
function isRetryable(tx: Transaction): boolean {
  return tx.status === TransactionStatus.Failed && !tx.providerTxId;
}

export function toView(tx: Transaction): OneTimePaymentView {
  return {
    id: tx.id,
    code: tx.code,
    status: tx.status,
    provider: tx.provider,
    amount: tx.amount,
    currency: tx.currency,
    checkoutUrl: tx.checkoutUrl ?? null,
    idempotencyKey: tx.idempotencyKey ?? null,
    metadata: tx.metadata ?? {},
    createdAt: tx.createdAt,
  };
}
