import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Paged, toPaged } from '../../common/dto/pagination.dto';
import { LogActor, TransactionStatus, TransactionType } from '../../common/enums';
import { PaymentsAppService } from '../payments/payments-app.service';
import { PaymentReconcilerService } from '../../common/services/payment-reconciler.service';
import { App, Transaction, TransactionLog, WebhookEvent } from '../../database/entities';
import { ListTransactionsDto, RefundDto } from './dto/list-transactions.dto';

@Injectable()
export class TransactionsAdminService {
  constructor(
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(TransactionLog) private readonly logs: Repository<TransactionLog>,
    @InjectRepository(WebhookEvent) private readonly webhooks: Repository<WebhookEvent>,
    @InjectRepository(App) private readonly apps: Repository<App>,
    private readonly reconciler: PaymentReconcilerService,
    private readonly payments: PaymentsAppService,
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

  /**
   * Operator-initiated refund.
   *
   * Delegates to the app-facing implementation rather than keeping a second
   * copy. The copy that used to live here validated nothing (a negative amount
   * was accepted and became a POSITIVE refund row), had no cumulative guard,
   * and — worst — never called the provider at all: it wrote a refund row and
   * returned 201 while no money moved. One implementation, one set of guards,
   * with the actor recorded as the admin rather than the app.
   */
  async refund(id: string, dto: RefundDto): Promise<Transaction> {
    const tx = await this.findOne(id);
    if (tx.type === TransactionType.Refund) {
      throw new BadRequestException({
        error: 'already_a_refund',
        message: 'A refund transaction cannot itself be refunded',
      });
    }
    const app = await this.apps.findOne({ where: { id: tx.appId } });
    if (!app) {
      throw new BadRequestException({
        error: 'app_not_found',
        message: `Transaction ${id} has no owning app to refund against`,
      });
    }
    return this.payments.refund(app, tx.id, dto, LogActor.Admin);
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
        b.where('LOWER(tx.code) LIKE :q', { q })
          .orWhere('LOWER(tx.id::text) LIKE :q', { q })
          .orWhere('LOWER(customer.name) LIKE :q', { q })
          .orWhere('LOWER(customer.email) LIKE :q', { q })
          .orWhere('LOWER(tx.description) LIKE :q', { q });
      }));
    }
    return qb;
  }
}
