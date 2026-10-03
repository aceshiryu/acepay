import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import {
  LogAction, LogActor, TransactionStatus, WebhookDeliveryStatus,
} from '../enums';
import { App, Transaction, WebhookEvent } from '../../database/entities';
import { ProviderRegistry } from '../../payment-providers/provider.registry';
import { WebhookDeliveryQueueService } from '../queue/webhook-delivery-queue.service';
import { TransactionLoggerService } from './transaction-logger.service';

export interface ReconcileResult {
  transactionId: string;
  before: TransactionStatus;
  after: TransactionStatus;
  changed: boolean;
  notifiedApp: boolean;
  reason?: string;
}

@Injectable()
export class PaymentReconcilerService {
  private readonly logger = new Logger(PaymentReconcilerService.name);

  constructor(
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(WebhookEvent) private readonly webhooks: Repository<WebhookEvent>,
    @InjectRepository(App) private readonly apps: Repository<App>,
    private readonly providers: ProviderRegistry,
    private readonly txLogger: TransactionLoggerService,
    private readonly deliveryQueue: WebhookDeliveryQueueService,
  ) {}

  /** Pull current state from provider, update tx if changed, log, and
   *  synthesize an outbound webhook delivery so the app catches up.
   *  Returns the reconciliation outcome. */
  async reconcile(tx: Transaction, actor: LogActor = LogActor.System): Promise<ReconcileResult> {
    const before = tx.status;

    if (!tx.providerTxId) {
      return {
        transactionId: tx.id, before, after: before, changed: false, notifiedApp: false,
        reason: 'no_provider_tx_id',
      };
    }

    const provider = this.providers.resolve(tx.provider);
    let fetched;
    try {
      // Marketplace payments live on the merchant's Xendit sub-account.
      fetched = tx.providerAccountId
        ? await provider.getPayment(tx.providerTxId, { forUserId: tx.providerAccountId })
        : await provider.getPayment(tx.providerTxId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Reconcile fetch failed for ${tx.id}: ${msg}`);
      return {
        transactionId: tx.id, before, after: before, changed: false, notifiedApp: false,
        reason: `provider_error: ${msg}`,
      };
    }

    if (fetched.status === before) {
      return { transactionId: tx.id, before, after: before, changed: false, notifiedApp: false };
    }

    // Apply the transition.
    tx.status = fetched.status;
    if (fetched.providerCompletedAt) tx.providerCompletedAt ??= fetched.providerCompletedAt;
    tx.webhookReceivedAt ??= new Date(); // we discovered it via reconcile, not webhook
    await this.transactions.save(tx);

    await this.txLogger.log({
      transaction: tx,
      action: actionForStatus(fetched.status),
      actor,
      statusFrom: before, statusTo: fetched.status,
      details: { source: 'reconcile', providerStatus: fetched.status },
    });

    // Synthesize a webhook event for the app so they catch up.
    const eventName = eventNameForStatus(fetched.status);
    let notifiedApp = false;
    if (eventName && tx.appId) {
      const app = await this.apps.findOne({ where: { id: tx.appId } });
      if (app && app.webhookUrl) {
        const synthEvent = this.webhooks.create({
          appId: tx.appId,
          transactionId: tx.id,
          provider: tx.provider,
          eventType: eventName,
          providerEventId: `acepay_reconcile_${tx.id}_${Date.now()}`,
          providerPayload: { source: 'reconcile', providerRaw: fetched.raw },
          normalizedPayload: {
            event: eventName,
            transaction_id: tx.id,
            provider: tx.provider,
            amount: tx.amount,
            currency: tx.currency,
            metadata: tx.metadata,
            source: 'reconcile',
            timestamps: {
              created_at: tx.createdAt,
              provider_completed_at: tx.providerCompletedAt,
              webhook_received_at: tx.webhookReceivedAt,
            },
          },
          deliveryStatus: WebhookDeliveryStatus.Pending,
        });
        const saved = await this.webhooks.save(synthEvent);
        // Enqueue for the worker to deliver — returns immediately, no longer blocks reconcile.
        await this.deliveryQueue.enqueue({ webhookEventId: saved.id, transactionId: tx.id });
        notifiedApp = true; // best-effort marker; worker is now responsible for actual delivery
      }
    }

    return { transactionId: tx.id, before, after: fetched.status, changed: true, notifiedApp };
  }

  /** Find pending transactions older than `staleAfterSeconds` and reconcile each. */
  async reconcileStale(staleAfterSeconds = 120, limit = 50): Promise<ReconcileResult[]> {
    const cutoff = new Date(Date.now() - staleAfterSeconds * 1000);
    const stale = await this.transactions.find({
      where: { status: TransactionStatus.Pending, createdAt: LessThan(cutoff) },
      order: { createdAt: 'ASC' },
      take: limit,
    });
    const out: ReconcileResult[] = [];
    for (const tx of stale) {
      try {
        out.push(await this.reconcile(tx, LogActor.System));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        out.push({
          transactionId: tx.id, before: tx.status, after: tx.status,
          changed: false, notifiedApp: false, reason: msg,
        });
      }
    }
    return out;
  }
}

function actionForStatus(status: TransactionStatus): LogAction {
  switch (status) {
    case TransactionStatus.Succeeded: return LogAction.PaymentSucceeded;
    case TransactionStatus.Failed:    return LogAction.PaymentFailed;
    case TransactionStatus.Refunded:  return LogAction.PaymentRefunded;
    default:                          return LogAction.PaymentWebhookReceived;
  }
}

function eventNameForStatus(status: TransactionStatus): string | null {
  switch (status) {
    case TransactionStatus.Succeeded: return 'payment.succeeded';
    case TransactionStatus.Failed:    return 'payment.failed';
    case TransactionStatus.Refunded:  return 'refund.succeeded';
    default:                          return null;
  }
}
