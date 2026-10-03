import {
  BadRequestException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Paged, toPaged } from '../../common/dto/pagination.dto';
import {
  LogAction, LogActor, TransactionStatus, TransactionType,
} from '../../common/enums';
import { PaymentReconcilerService, ReconcileResult } from '../../common/services/payment-reconciler.service';
import { TransactionLoggerService } from '../../common/services/transaction-logger.service';
import { App, Transaction } from '../../database/entities';
import { ProviderRegistry } from '../../payment-providers/provider.registry';
import { ListPaymentsAppDto, RefundPaymentDto } from './dto/list-payments-app.dto';

const AUTO_SYNC_AFTER_MS = 30_000;

/**
 * Read / refund / sync for transactions belonging to the calling app.
 * One-time payment creation (POST /v1/payments) was removed in the 2026-05-17
 * simplification — subscription billing creates Transactions automatically
 * via webhooks; this service lets apps inspect, refund, and reconcile those.
 */
@Injectable()
export class PaymentsAppService {
  constructor(
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    private readonly providers: ProviderRegistry,
    private readonly txLogger: TransactionLoggerService,
    private readonly reconciler: PaymentReconcilerService,
  ) {}

  async findOne(app: App, id: string): Promise<Transaction> {
    const tx = await this.transactions.findOne({ where: { id, appId: app.id } });
    if (!tx) {
      throw new NotFoundException({ error: 'transaction_not_found', message: `Transaction ${id} not found` });
    }
    if (tx.status === TransactionStatus.Pending && tx.providerTxId) {
      const ageMs = Date.now() - new Date(tx.createdAt).getTime();
      if (ageMs > AUTO_SYNC_AFTER_MS) {
        const result = await this.reconciler.reconcile(tx, LogActor.System);
        if (result.changed) {
          const refreshed = await this.transactions.findOne({ where: { id, appId: app.id } });
          if (refreshed) return refreshed;
        }
      }
    }
    return tx;
  }

  async sync(app: App, id: string): Promise<ReconcileResult & { transaction: Transaction }> {
    const tx = await this.transactions.findOne({ where: { id, appId: app.id } });
    if (!tx) {
      throw new NotFoundException({ error: 'transaction_not_found', message: `Transaction ${id} not found` });
    }
    const result = await this.reconciler.reconcile(tx, LogActor.App);
    const refreshed = (await this.transactions.findOne({ where: { id, appId: app.id } })) ?? tx;
    return { ...result, transaction: refreshed };
  }

  async list(app: App, q: ListPaymentsAppDto): Promise<Paged<Transaction>> {
    const qb = this.transactions.createQueryBuilder('tx').where('tx.app_id = :appId', { appId: app.id });
    if (q.provider)   qb.andWhere('tx.provider = :provider', { provider: q.provider });
    if (q.type)       qb.andWhere('tx.type = :type', { type: q.type });
    if (q.status)     qb.andWhere('tx.status = :status', { status: q.status });
    if (q.source)     qb.andWhere('tx.source = :source', { source: q.source });
    if (q.customerId) qb.andWhere('tx.customer_id = :customerId', { customerId: q.customerId });
    if (q.from)       qb.andWhere('tx.created_at >= :from', { from: q.from });
    if (q.to)         qb.andWhere('tx.created_at <= :to', { to: q.to });
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    qb.orderBy('tx.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return toPaged(data, total, page, pageSize);
  }

  async refund(
    app: App,
    id: string,
    dto: RefundPaymentDto,
    actor: LogActor = LogActor.App,
  ): Promise<Transaction> {
    const tx = await this.findOne(app, id);
    if (tx.status !== TransactionStatus.Succeeded) {
      throw new BadRequestException({
        error: 'not_refundable',
        message: `Transaction is ${tx.status}; only succeeded payments can be refunded`,
      });
    }
    if (!tx.providerTxId) {
      throw new BadRequestException({ error: 'no_provider_tx', message: 'Transaction has no provider id to refund' });
    }
    const amount = dto.amount ?? tx.amount;
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new BadRequestException({
        error: 'invalid_refund_amount',
        message: 'Refund amount must be a positive whole number in the smallest currency unit',
      });
    }
    if (amount > tx.amount) {
      throw new BadRequestException({ error: 'amount_exceeds_original', message: `Refund amount exceeds original` });
    }

    // Reserve, then settle. Checking the refunded total and inserting the refund
    // row have to be atomic: without a lock two simultaneous partial refunds
    // both read the same total, both pass, and the payment is over-refunded.
    // Proven live — two concurrent 30000 refunds against a 49900 payment both
    // reached the provider. The reservation row counts toward the total from the
    // moment it exists, and is marked failed if the provider rejects it, so a
    // failed attempt stops blocking later ones.
    const reserved = await this.transactions.manager.transaction(async (em) => {
      // Lock the original so concurrent refunds against it serialise here.
      await em.findOne(Transaction, {
        where: { id: tx.id, appId: app.id },
        lock: { mode: 'pessimistic_write' },
      });

      const alreadyRow = await em.createQueryBuilder(Transaction, 't')
        .select('COALESCE(SUM(-t.amount), 0)', 'refunded')
        .where('t.app_id = :appId', { appId: app.id })
        .andWhere('t.type = :type', { type: TransactionType.Refund })
        .andWhere("t.metadata ->> 'refundOf' = :txId", { txId: tx.id })
        .andWhere('t.status != :failed', { failed: TransactionStatus.Failed })
        .getRawOne<{ refunded: string }>();
      const alreadyRefunded = Number(alreadyRow?.refunded ?? 0) || 0;
      const refundable = tx.amount - alreadyRefunded;
      if (amount > refundable) {
        throw new BadRequestException({
          error: 'amount_exceeds_refundable',
          message: `Only ${refundable} of ${tx.amount} is still refundable; ${alreadyRefunded} has already been refunded`,
          refundable,
          alreadyRefunded,
        });
      }

      return em.save(em.create(Transaction, {
        appId: tx.appId,
        customerId: tx.customerId,
        provider: tx.provider,
        type: TransactionType.Refund,
        status: TransactionStatus.Pending,
        amount: -amount,
        currency: tx.currency,
        description: `Refund of ${tx.id}${dto.reason ? ` — ${dto.reason}` : ''}`,
        metadata: { refundOf: tx.id, reason: dto.reason ?? null },
        merchantId: tx.merchantId ?? null,
        providerAccountId: tx.providerAccountId ?? null,
      }));
    });

    // The provider call happens outside the lock, so a slow provider does not
    // hold up every other refund on this payment.
    const provider = this.providers.resolve(tx.provider);
    let result;
    try {
      // A marketplace refund comes out of the merchant's sub-account. The
      // platform fee is NOT returned automatically (Xendit doesn't reverse splits).
      result = tx.providerAccountId
        ? await provider.refund(tx.providerTxId, amount, { forUserId: tx.providerAccountId })
        : await provider.refund(tx.providerTxId, amount);
    } catch (err) {
      // Release the reservation so it stops counting against the balance.
      reserved.status = TransactionStatus.Failed;
      await this.transactions.save(reserved);
      throw err;
    }

    reserved.status = result.status;
    reserved.providerTxId = result.providerRefundId;
    const refund = await this.transactions.save(reserved);

    await this.txLogger.log({
      transaction: tx, action: LogAction.PaymentRefundRequested,
      actor, statusFrom: tx.status, statusTo: tx.status,
      details: { refundTx: refund.id, amount },
    });
    return refund;
  }
}
