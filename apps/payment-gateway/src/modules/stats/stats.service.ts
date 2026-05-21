import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import {
  Provider, SubscriptionStatus, TransactionStatus, WebhookDeliveryStatus,
} from '../../common/enums';
import {
  App, Subscription, Transaction, WebhookEvent,
} from '../../database/entities';

export interface CurrencyAmount { currency: string; amount: number }
export interface ProviderHealth { name: Provider; status: 'ok' | 'warn' | 'bad'; lastWebhookAt: Date | null }

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(App) private readonly apps: Repository<App>,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(Subscription) private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(WebhookEvent) private readonly webhooks: Repository<WebhookEvent>,
  ) {}

  async dashboard() {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - 6); startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      transactionsToday,
      revenueToday,
      successRate,
      activeSubscriptions,
      thisWeekVolume,
      thisMonthVolume,
      failedWebhooksPending,
      totalApps,
      activeApps,
    ] = await Promise.all([
      this.countTransactions(startOfDay, now),
      this.sumByCurrency({ from: startOfDay, to: now, statuses: [TransactionStatus.Succeeded, TransactionStatus.Refunded] }),
      this.computeSuccessRate(startOfDay, now),
      this.subscriptions.count({ where: { status: SubscriptionStatus.Active } }),
      this.sumByCurrency({ from: startOfWeek, to: now, statuses: [TransactionStatus.Succeeded] }),
      this.sumByCurrency({ from: startOfMonth, to: now, statuses: [TransactionStatus.Succeeded] }),
      this.webhooks.count({
        where: { deliveryStatus: In([WebhookDeliveryStatus.Failed, WebhookDeliveryStatus.Exhausted]) },
      }),
      this.apps.count(),
      this.apps.count({ where: { isActive: true } }),
    ]);

    return {
      now: now.toISOString(),
      transactionsToday,
      revenueToday,
      successRate,
      activeSubscriptions,
      thisWeekVolume,
      thisMonthVolume,
      failedWebhooksPending,
      totalApps,
      activeApps,
    };
  }

  async providerStatus(): Promise<{ providers: ProviderHealth[] }> {
    const providers: ProviderHealth[] = [];
    for (const provider of Object.values(Provider)) {
      const last = await this.webhooks.findOne({
        where: { provider },
        order: { createdAt: 'DESC' },
      });
      const lastWebhookAt = last?.createdAt ?? null;
      const ageMinutes = lastWebhookAt
        ? (Date.now() - lastWebhookAt.getTime()) / 60_000
        : Number.POSITIVE_INFINITY;
      const status: ProviderHealth['status'] =
        ageMinutes <= 30 ? 'ok' : ageMinutes <= 120 ? 'warn' : 'bad';
      providers.push({ name: provider, status, lastWebhookAt });
    }
    return { providers };
  }

  async appSummary(appId: string) {
    const [
      txCount, revenue, activeSubs, successRate,
    ] = await Promise.all([
      this.transactions.count({ where: { appId } }),
      this.sumByCurrency({ statuses: [TransactionStatus.Succeeded], appId }),
      this.subscriptions.count({ where: { appId, status: SubscriptionStatus.Active } }),
      this.computeSuccessRate(undefined, undefined, appId),
    ]);
    return { txCount, revenue, activeSubs, successRate };
  }

  // ── helpers ────────────────────────────────────────────────────────────
  private countTransactions(from: Date, to: Date): Promise<number> {
    return this.transactions.count({ where: { createdAt: Between(from, to) } });
  }

  private async computeSuccessRate(from?: Date, to?: Date, appId?: string): Promise<number | null> {
    const qb = this.transactions.createQueryBuilder('tx')
      .select('tx.status', 'status').addSelect('COUNT(*)', 'count')
      .where('tx.status IN (:...st)', {
        st: [TransactionStatus.Succeeded, TransactionStatus.Failed],
      })
      .groupBy('tx.status');
    if (from && to) qb.andWhere('tx.created_at BETWEEN :from AND :to', { from, to });
    if (appId) qb.andWhere('tx.app_id = :appId', { appId });
    const rows = await qb.getRawMany<{ status: TransactionStatus; count: string }>();
    let succeeded = 0, failed = 0;
    for (const r of rows) {
      if (r.status === TransactionStatus.Succeeded) succeeded = Number(r.count);
      if (r.status === TransactionStatus.Failed) failed = Number(r.count);
    }
    const total = succeeded + failed;
    if (total === 0) return null;
    return Math.round((succeeded / total) * 1000) / 10;
  }

  private async sumByCurrency(opts: {
    from?: Date; to?: Date; statuses?: TransactionStatus[]; appId?: string;
  }): Promise<CurrencyAmount[]> {
    const qb = this.transactions.createQueryBuilder('tx')
      .select('tx.currency', 'currency')
      .addSelect('SUM(tx.amount)', 'amount')
      .groupBy('tx.currency');
    if (opts.statuses?.length) qb.andWhere('tx.status IN (:...st)', { st: opts.statuses });
    if (opts.from && opts.to) qb.andWhere('tx.created_at BETWEEN :from AND :to', { from: opts.from, to: opts.to });
    if (opts.appId) qb.andWhere('tx.app_id = :appId', { appId: opts.appId });
    const rows = await qb.getRawMany<{ currency: string; amount: string }>();
    return rows.map(r => ({ currency: r.currency, amount: Number(r.amount) }));
  }
}
