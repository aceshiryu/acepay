import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { Repository } from 'typeorm';
import { decryptSecret, hmacSha256 } from '../crypto';
import { LogAction, WebhookDeliveryStatus } from '../enums';
import { App, Transaction, WebhookEvent } from '../../database/entities';
import { TransactionLoggerService } from './transaction-logger.service';

const DELIVERY_TIMEOUT_MS = 10_000;

@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(
    @InjectRepository(WebhookEvent) private readonly webhooks: Repository<WebhookEvent>,
    private readonly txLogger: TransactionLoggerService,
  ) {}

  /** Sign and POST a normalized payload to the app's webhook URL.
   *  Records the attempt + final delivery_status on the WebhookEvent.
   */
  async deliver(app: App, event: WebhookEvent, transaction: Transaction | null): Promise<void> {
    if (!app.webhookUrl) {
      this.logger.warn(`App ${app.slug} has no webhook URL — skipping delivery for ${event.id}`);
      event.deliveryStatus = WebhookDeliveryStatus.Failed;
      event.lastResponseStatus = 0;
      event.lastResponseBody = 'no_webhook_url_configured';
      event.attempts += 1;
      event.lastAttemptAt = new Date();
      event.firstAttemptAt ??= event.lastAttemptAt;
      await this.webhooks.save(event);
      return;
    }
    if (!app.webhookSecretEnc) {
      throw new Error(`App ${app.slug} has no webhook secret`);
    }
    const secret = decryptSecret(app.webhookSecretEnc);
    const body = JSON.stringify(event.normalizedPayload ?? {});
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = hmacSha256(secret, `${timestamp}.${body}`);

    const now = new Date();
    event.attempts += 1;
    event.firstAttemptAt ??= now;
    event.lastAttemptAt = now;

    try {
      const resp = await axios.post(app.webhookUrl, body, {
        timeout: DELIVERY_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'x-acepay-signature': `sha256=${signature}`,
          'x-acepay-timestamp': timestamp,
          'x-acepay-event': String(event.eventType),
          'x-acepay-event-id': event.id,
        },
        validateStatus: () => true,
      });
      event.lastResponseStatus = resp.status;
      event.lastResponseBody = typeof resp.data === 'string'
        ? resp.data.slice(0, 4000)
        : JSON.stringify(resp.data).slice(0, 4000);

      if (resp.status >= 200 && resp.status < 300) {
        event.deliveryStatus = WebhookDeliveryStatus.Delivered;
        event.deliveredAt = new Date();
        if (transaction) {
          transaction.appNotifiedAt = event.deliveredAt;
          await this.txLogger.log({
            transaction,
            action: LogAction.PaymentAppNotified,
            statusFrom: transaction.status,
            statusTo: transaction.status,
            providerEventId: event.providerEventId,
            details: { url: app.webhookUrl, status: resp.status },
          });
        }
      } else {
        await this.markFailed(event, transaction, app, `non-2xx: ${resp.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      event.lastResponseStatus = 0;
      event.lastResponseBody = message.slice(0, 4000);
      await this.markFailed(event, transaction, app, message);
    } finally {
      await this.webhooks.save(event);
    }
  }

  private async markFailed(event: WebhookEvent, transaction: Transaction | null, app: App, reason: string) {
    const exhausted = event.attempts >= event.maxAttempts;
    event.deliveryStatus = exhausted ? WebhookDeliveryStatus.Exhausted : WebhookDeliveryStatus.Failed;
    if (transaction) {
      await this.txLogger.log({
        transaction,
        action: exhausted ? LogAction.PaymentAppNotifyFailed : LogAction.PaymentAppNotifyRetry,
        statusFrom: transaction.status,
        statusTo: transaction.status,
        providerEventId: event.providerEventId,
        details: { url: app.webhookUrl, attempts: event.attempts, reason },
      });
    }
  }
}
