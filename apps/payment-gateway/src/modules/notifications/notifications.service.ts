import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Paged, toPaged } from '../../common/dto/pagination.dto';
import {
  LogAction, WebhookDeliveryStatus,
} from '../../common/enums';
import { TransactionLog, WebhookEvent } from '../../database/entities';

export type NotificationSeverity = 'critical' | 'warn' | 'info' | 'success';
export type NotificationLinkKind =
  | 'transaction-detail' | 'webhook-detail' | 'subscription-detail' | 'app-detail';

export interface Notification {
  id: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  app: { id: string; name: string } | null;
  createdAt: string;
  link?: { page: NotificationLinkKind; param: string; label: string };
}

export interface NotificationStats {
  total: number;
  critical: number;
  warn: number;
  info: number;
  success: number;
}

const SOURCE_WINDOW = 200; // recent rows pulled per source before merge

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(WebhookEvent) private readonly webhooks: Repository<WebhookEvent>,
    @InjectRepository(TransactionLog) private readonly logs: Repository<TransactionLog>,
  ) {}

  async list(opts: { page?: number; pageSize?: number; severity?: NotificationSeverity }): Promise<Paged<Notification>> {
    const all = await this.assemble();
    const filtered = opts.severity ? all.filter((n) => n.severity === opts.severity) : all;
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    return toPaged(filtered.slice(start, start + pageSize), filtered.length, page, pageSize);
  }

  async stats(): Promise<NotificationStats> {
    const all = await this.assemble();
    const out: NotificationStats = { total: all.length, critical: 0, warn: 0, info: 0, success: 0 };
    for (const n of all) out[n.severity]++;
    return out;
  }

  /** Pull recent rows from each source, normalize to Notification, sort, dedupe by id. */
  private async assemble(): Promise<Notification[]> {
    const [hooks, failedTxLogs, refundLogs] = await Promise.all([
      this.webhooks.find({
        where: { deliveryStatus: In([WebhookDeliveryStatus.Failed, WebhookDeliveryStatus.Exhausted]) },
        order: { createdAt: 'DESC' },
        take: SOURCE_WINDOW,
        relations: { app: true },
      }),
      this.logs.find({
        where: { action: LogAction.PaymentFailed },
        order: { createdAt: 'DESC' },
        take: SOURCE_WINDOW,
        relations: { app: true, transaction: true },
      }),
      this.logs.find({
        where: { action: LogAction.PaymentRefunded },
        order: { createdAt: 'DESC' },
        take: SOURCE_WINDOW,
        relations: { app: true, transaction: true },
      }),
    ]);

    const out: Notification[] = [
      ...hooks.map(notificationFromWebhook),
      ...failedTxLogs.map(notificationFromFailedPayment),
      ...refundLogs.map(notificationFromRefund),
    ];

    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  }
}

// ── synthesizers ───────────────────────────────────────────────────────────

function notificationFromWebhook(w: WebhookEvent): Notification {
  const exhausted = w.deliveryStatus === WebhookDeliveryStatus.Exhausted;
  return {
    id: `wh_${w.id}`,
    severity: exhausted ? 'critical' : 'warn',
    title: exhausted ? 'Webhook delivery exhausted' : 'Webhook delivery failing',
    body: exhausted
      ? `${w.eventType} hit ${w.attempts}/${w.maxAttempts} retry attempts. Manual retry required.`
      : `${w.eventType} failed delivery (${w.attempts}/${w.maxAttempts} attempts so far). Auto-retry in progress.`,
    app: w.app ? { id: w.app.id, name: w.app.name } : null,
    createdAt: (w.lastAttemptAt ?? w.createdAt).toISOString(),
    link: { page: 'webhook-detail', param: w.id, label: 'View event' },
  };
}

function notificationFromFailedPayment(l: TransactionLog): Notification {
  return {
    id: `tx_failed_${l.id}`,
    severity: 'warn',
    title: 'Payment failed',
    body: l.transaction
      ? `Transaction ${l.transaction.id.slice(0, 8)}… for ${formatAmount(l.transaction.amount, l.transaction.currency)} via ${l.transaction.provider} was declined.`
      : `A payment was declined.`,
    app: l.app ? { id: l.app.id, name: l.app.name } : null,
    createdAt: l.createdAt.toISOString(),
    link: l.transactionId ? { page: 'transaction-detail', param: l.transactionId, label: 'View transaction' } : undefined,
  };
}

function notificationFromRefund(l: TransactionLog): Notification {
  return {
    id: `tx_refund_${l.id}`,
    severity: 'info',
    title: 'Refund issued',
    body: l.transaction
      ? `${formatAmount(Math.abs(l.transaction.amount), l.transaction.currency)} refunded on ${l.transaction.id.slice(0, 8)}…`
      : `A refund was issued.`,
    app: l.app ? { id: l.app.id, name: l.app.name } : null,
    createdAt: l.createdAt.toISOString(),
    link: l.transactionId ? { page: 'transaction-detail', param: l.transactionId, label: 'View transaction' } : undefined,
  };
}

function formatAmount(amount: number, currency: string): string {
  const major = amount / 100;
  const symbol = currency === 'PHP' ? '₱' : currency === 'USD' ? '$' : `${currency} `;
  return `${symbol}${major.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
