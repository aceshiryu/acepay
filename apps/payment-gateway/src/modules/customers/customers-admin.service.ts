import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, MoreThanOrEqual, Repository } from 'typeorm';
import { Paged, toPaged } from '../../common/dto/pagination.dto';
import { SubscriptionStatus } from '../../common/enums';
import { Customer, Subscription, Transaction } from '../../database/entities';
import { ListCustomersDto } from './dto/list-customers.dto';

export interface CustomerListRow {
  customer: Customer;
  subscriptionsCount: number;
  transactionsCount: number;
}

@Injectable()
export class CustomersAdminService {
  constructor(
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    @InjectRepository(Subscription) private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
  ) {}

  async list(filters: ListCustomersDto): Promise<Paged<CustomerListRow>> {
    const qb = this.buildQuery(filters);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    qb.orderBy('cust.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize);
    const [rows, total] = await qb.getManyAndCount();
    const enriched = await Promise.all(rows.map(async (c) => ({
      customer: c,
      subscriptionsCount: await this.subscriptions.count({
        where: { customerId: c.id, status: SubscriptionStatus.Active },
      }),
      transactionsCount: await this.transactions.count({ where: { customerId: c.id } }),
    })));
    return toPaged(enriched, total, page, pageSize);
  }

  async findOne(id: string) {
    const customer = await this.customers.findOne({
      where: { id }, relations: { app: true },
    });
    if (!customer) {
      throw new NotFoundException({
        error: 'customer_not_found', message: `Customer ${id} not found`,
      });
    }
    const [subscriptions, transactions] = await Promise.all([
      this.subscriptions.find({ where: { customerId: id }, relations: { plan: true }, order: { createdAt: 'DESC' } }),
      this.transactions.find({ where: { customerId: id }, order: { createdAt: 'DESC' } }),
    ]);
    return { ...customer, subscriptions, transactions };
  }

  async stats() {
    const startOfMonth = new Date();
    startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
    const [
      total,
      withSubsRaw,
      joinedThisMonth,
      topAppRaw,
    ] = await Promise.all([
      this.customers.count(),
      this.subscriptions.createQueryBuilder('sub')
        .select('COUNT(DISTINCT sub.customer_id)', 'count')
        .where('sub.status = :status', { status: SubscriptionStatus.Active })
        .getRawOne<{ count: string }>(),
      this.customers.count({ where: { createdAt: MoreThanOrEqual(startOfMonth) } }),
      this.customers.createQueryBuilder('cust')
        .leftJoin('cust.app', 'app')
        .select('app.id', 'appId').addSelect('app.name', 'appName')
        .addSelect('COUNT(*)', 'count')
        .groupBy('app.id').addGroupBy('app.name')
        .orderBy('count', 'DESC').limit(1)
        .getRawOne<{ appId: string; appName: string; count: string }>(),
    ]);
    return {
      total,
      withSubscriptions: Number(withSubsRaw?.count ?? 0),
      joinedThisMonth,
      topApp: topAppRaw ? {
        id: topAppRaw.appId, name: topAppRaw.appName, count: Number(topAppRaw.count),
      } : null,
    };
  }

  private buildQuery(filters: ListCustomersDto) {
    const qb = this.customers.createQueryBuilder('cust')
      .leftJoinAndSelect('cust.app', 'app');
    if (filters.appId)      qb.andWhere('cust.app_id = :appId', { appId: filters.appId });
    if (filters.joinedFrom) qb.andWhere('cust.created_at >= :from', { from: filters.joinedFrom });
    if (filters.joinedTo)   qb.andWhere('cust.created_at <= :to', { to: filters.joinedTo });
    if (filters.search) {
      const q = `%${filters.search.toLowerCase()}%`;
      qb.andWhere(new Brackets((b) => {
        b.where('LOWER(cust.code) LIKE :q', { q })
          .orWhere('LOWER(cust.name) LIKE :q', { q })
          .orWhere('LOWER(cust.email) LIKE :q', { q })
          .orWhere('LOWER(cust.external_id) LIKE :q', { q });
      }));
    }
    return qb;
  }
}
