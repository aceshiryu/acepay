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

  async refund(app: App, id: string, dto: RefundPaymentDto): Promise<Transaction> {
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
    if (amount > tx.amount) {
      throw new BadRequestException({ error: 'amount_exceeds_original', message: `Refund amount exceeds original` });
    }

    const provider = this.providers.resolve(tx.provider);
    const result = await provider.refund(tx.providerTxId, amount);

    let refund = this.transactions.create({
      appId: tx.appId,
      customerId: tx.customerId,
      provider: tx.provider,
      providerTxId: result.providerRefundId,
      type: TransactionType.Refund,
      status: result.status,
      amount: -amount,
      currency: tx.currency,
      description: `Refund of ${tx.id}${dto.reason ? ` — ${dto.reason}` : ''}`,
      metadata: { refundOf: tx.id, reason: dto.reason ?? null },
    });
    refund = await this.transactions.save(refund);

    await this.txLogger.log({
      transaction: tx, action: LogAction.PaymentRefundRequested,
      actor: LogActor.App, statusFrom: tx.status, statusTo: tx.status,
      details: { refundTx: refund.id, amount },
    });
    return refund;
  }
}
