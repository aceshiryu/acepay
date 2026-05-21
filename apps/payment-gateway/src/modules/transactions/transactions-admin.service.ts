import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Paged, toPaged } from '../../common/dto/pagination.dto';
import { LogActor, TransactionStatus, TransactionType } from '../../common/enums';
import { PaymentReconcilerService } from '../../common/services/payment-reconciler.service';
import {
  Transaction, TransactionLog, WebhookEvent,
} from '../../database/entities';
import { ListTransactionsDto, RefundDto } from './dto/list-transactions.dto';

@Injectable()
export class TransactionsAdminService {
  constructor(
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(TransactionLog) private readonly logs: Repository<TransactionLog>,
    @InjectRepository(WebhookEvent) private readonly webhooks: Repository<WebhookEvent>,
    private readonly reconciler: PaymentReconcilerService,
  ) {}

  async sync(id: string) {
    const tx = await this.transactions.findOne({ where: { id } });
    if (!tx) {
      throw new NotFoundException({ error: 'transaction_not_found', message: `Transaction ${id} not found` });
    }
    return this.reconciler.reconcile(tx, LogActor.Admin);
  }

  async reconcileStale(staleAfterSeconds = 120, limit = 50) {
    return this.reconciler.reconcileStale(staleAfterSeconds, limit);
  }

  async list(filters: ListTransactionsDto): Promise<Paged<Transaction>> {
    const qb = this.buildListQuery(filters);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    qb.orderBy('tx.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return toPaged(data, total, page, pageSize);
  }

  async stats(filters: ListTransactionsDto) {
    const qb = this.buildListQuery(filters)
      .select('tx.status', 'status').addSelect('COUNT(*)', 'count')
      .groupBy('tx.status');
    const rows = await qb.getRawMany<{ status: TransactionStatus; count: string }>();
    const out: Record<string, number> = {
      total: 0, succeeded: 0, pending: 0, failed: 0, refunded: 0,
    };
    for (const r of rows) {
      const n = Number(r.count);
      out[r.status] = n;
      out.total += n;
    }
    return out;
  }

  async findOne(id: string): Promise<Transaction & {
    logs: TransactionLog[];
    webhookEvents: WebhookEvent[];
  }> {
    const tx = await this.transactions.findOne({
      where: { id },
      relations: { app: true, customer: true, subscription: true },
    });
    if (!tx) {
      throw new NotFoundException({ error: 'transaction_not_found', message: `Transaction ${id} not found` });
    }
    const [logs, webhookEvents] = await Promise.all([
      this.logs.find({ where: { transactionId: id }, order: { createdAt: 'ASC' } }),
      this.webhooks.find({ where: { transactionId: id }, order: { createdAt: 'ASC' } }),
    ]);
    return { ...tx, logs, webhookEvents };
  }

  async logsFor(id: string): Promise<TransactionLog[]> {
    await this.findOne(id);
    return this.logs.find({ where: { transactionId: id }, order: { createdAt: 'ASC' } });
  }

  async refund(id: string, dto: RefundDto): Promise<Transaction> {
    const tx = await this.findOne(id);
    if (tx.status !== TransactionStatus.Succeeded) {
      throw new BadRequestException({
        error: 'not_refundable',
        message: `Transaction is ${tx.status}; only succeeded payments can be refunded`,
      });
    }
    if (tx.type === TransactionType.Refund) {
      throw new BadRequestException({
        error: 'already_a_refund',
        message: 'A refund transaction cannot itself be refunded',
      });
    }
    const amount = dto.amount ?? tx.amount;
    if (amount > tx.amount) {
      throw new BadRequestException({
        error: 'amount_exceeds_original',
        message: `Refund amount ${amount} exceeds original ${tx.amount}`,
      });
    }
    // Provider call is built in slice 4. For now we record the refund row + log.
    const refund = this.transactions.create({
      appId: tx.appId,
      customerId: tx.customerId,
      subscriptionId: tx.subscriptionId,
      provider: tx.provider,
      type: TransactionType.Refund,
      status: TransactionStatus.Pending,
      amount: -amount,
      currency: tx.currency,
      description: `Refund of ${tx.id}${dto.reason ? ` — ${dto.reason}` : ''}`,
      metadata: { refundOf: tx.id, reason: dto.reason ?? null },
      idempotencyKey: `refund_${tx.id}_${Date.now()}`,
    });
    return this.transactions.save(refund);
  }

  // ── helpers ────────────────────────────────────────────────────────────
  private buildListQuery(filters: ListTransactionsDto) {
    const qb = this.transactions.createQueryBuilder('tx')
      .leftJoinAndSelect('tx.app', 'app')
      .leftJoinAndSelect('tx.customer', 'customer');

    if (filters.appId)         qb.andWhere('tx.app_id = :appId', { appId: filters.appId });
    if (filters.customerId)    qb.andWhere('tx.customer_id = :customerId', { customerId: filters.customerId });
    if (filters.subscriptionId)qb.andWhere('tx.subscription_id = :subscriptionId', { subscriptionId: filters.subscriptionId });
    if (filters.provider)      qb.andWhere('tx.provider = :provider', { provider: filters.provider });
    if (filters.type)          qb.andWhere('tx.type = :type', { type: filters.type });
    if (filters.status)        qb.andWhere('tx.status = :status', { status: filters.status });
    if (filters.source)        qb.andWhere('tx.source = :source', { source: filters.source });
    if (filters.from)          qb.andWhere('tx.created_at >= :from', { from: filters.from });
    if (filters.to)            qb.andWhere('tx.created_at <= :to', { to: filters.to });

    if (filters.search) {
      const q = `%${filters.search.toLowerCase()}%`;
      qb.andWhere(new Brackets((b) => {
        b.where('LOWER(tx.id::text) LIKE :q', { q })
          .orWhere('LOWER(customer.name) LIKE :q', { q })
          .orWhere('LOWER(customer.email) LIKE :q', { q })
          .orWhere('LOWER(tx.description) LIKE :q', { q });
      }));
    }
    return qb;
  }
}
