import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Paged, toPaged } from '../../common/dto/pagination.dto';
import { PlanInterval, SubscriptionStatus } from '../../common/enums';
import { Subscription, Transaction } from '../../database/entities';
import { ProviderRegistry } from '../../payment-providers/provider.registry';
import { ListSubscriptionsDto } from './dto/list-subscriptions.dto';

export interface CurrencyAmount { currency: string; amount: number }

@Injectable()
export class SubscriptionsAdminService {
  constructor(
    @InjectRepository(Subscription) private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    private readonly providers: ProviderRegistry,
  ) {}

  async list(filters: ListSubscriptionsDto): Promise<Paged<Subscription>> {
    const qb = this.buildListQuery(filters);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    qb.orderBy('sub.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return toPaged(data, total, page, pageSize);
  }

  async findOne(id: string): Promise<Subscription & { transactions: Transaction[] }> {
    const sub = await this.subscriptions.findOne({
      where: { id },
      relations: { app: true, customer: true, plan: true },
    });
    if (!sub) {
      throw new NotFoundException({
        error: 'subscription_not_found', message: `Subscription ${id} not found`,
      });
    }
    const transactions = await this.transactions.find({
      where: { subscriptionId: id },
      order: { createdAt: 'DESC' },
    });
    return { ...sub, transactions };
  }

  async stats(filters: ListSubscriptionsDto) {
    const qb = this.buildListQuery(filters)
      .select('sub.status', 'status').addSelect('COUNT(*)', 'count')
      .groupBy('sub.status');
    const rows = await qb.getRawMany<{ status: SubscriptionStatus; count: string }>();
    const out: Record<string, number> = {
      total: 0, active: 0, past_due: 0, canceled: 0, paused: 0, expired: 0,
    };
    for (const r of rows) {
      const n = Number(r.count);
      out[r.status] = n;
      out.total += n;
    }
    out.mrrEstimate = 0; // for backwards compat — replaced by mrrByCurrency below
    delete out.mrrEstimate;
    const mrr = await this.computeMrr(filters);
    return { ...out, mrrEstimate: mrr };
  }

  async cancel(id: string): Promise<Subscription> {
    const sub = await this.findOneRaw(id);
    if (sub.status === SubscriptionStatus.Canceled) return sub;
    const provider = this.providers.resolve(sub.provider);
    const result = await provider.cancelSubscription(sub.providerSubscriptionId);
    sub.status = result.status;
    sub.cancelAt = result.cancelAt;
    sub.canceledAt = result.canceledAt ?? new Date();
    return this.subscriptions.save(sub);
  }

  async pause(id: string): Promise<Subscription> {
    const sub = await this.findOneRaw(id);
    if (sub.status === SubscriptionStatus.Paused) return sub;
    const provider = this.providers.resolve(sub.provider);
    const result = await provider.pauseSubscription(sub.providerSubscriptionId);
    sub.status = result.status;
    return this.subscriptions.save(sub);
  }

  async resume(id: string): Promise<Subscription> {
    const sub = await this.findOneRaw(id);
    if (sub.status === SubscriptionStatus.Active) return sub;
    const provider = this.providers.resolve(sub.provider);
    const result = await provider.resumeSubscription(sub.providerSubscriptionId);
    sub.status = result.status;
    return this.subscriptions.save(sub);
  }

  private async findOneRaw(id: string): Promise<Subscription> {
    const sub = await this.subscriptions.findOne({ where: { id } });
    if (!sub) {
      throw new NotFoundException({
        error: 'subscription_not_found', message: `Subscription ${id} not found`,
      });
    }
    return sub;
  }

  // Estimate MRR by summing monthly-equivalent amounts of active subs
  private async computeMrr(filters: ListSubscriptionsDto): Promise<CurrencyAmount[]> {
    // buildListQuery already joins sub.plan as "plan" — don't double-join.
    const qb = this.buildListQuery({ ...filters, status: SubscriptionStatus.Active })
      .select('plan.currency', 'currency')
      .addSelect(
        // monthly equivalent: amount * (12 / interval-months)
        // For monthly: amount; weekly: amount*4.33; yearly: amount/12
        `SUM(CASE plan.interval
              WHEN '${PlanInterval.Monthly}' THEN plan.amount * plan.interval_count
              WHEN '${PlanInterval.Yearly}'  THEN plan.amount / (12 * plan.interval_count)
              WHEN '${PlanInterval.Weekly}'  THEN plan.amount * (52 / (12 * plan.interval_count))
              ELSE plan.amount
            END)`,
        'amount',
      )
      .groupBy('plan.currency');
    const rows = await qb.getRawMany<{ currency: string; amount: string }>();
    return rows
      .filter(r => r.currency != null)
      .map(r => ({ currency: r.currency, amount: Math.round(Number(r.amount)) }));
  }

  private buildListQuery(filters: ListSubscriptionsDto) {
    const qb = this.subscriptions.createQueryBuilder('sub')
      .leftJoinAndSelect('sub.app', 'app')
      .leftJoinAndSelect('sub.customer', 'customer')
      .leftJoinAndSelect('sub.plan', 'plan');
    if (filters.appId)      qb.andWhere('sub.app_id = :appId', { appId: filters.appId });
    if (filters.customerId) qb.andWhere('sub.customer_id = :customerId', { customerId: filters.customerId });
    if (filters.provider)   qb.andWhere('sub.provider = :provider', { provider: filters.provider });
    if (filters.status)     qb.andWhere('sub.status = :status', { status: filters.status });
    if (filters.from)       qb.andWhere('sub.created_at >= :from', { from: filters.from });
    if (filters.to)         qb.andWhere('sub.created_at <= :to', { to: filters.to });
    return qb;
  }
}
