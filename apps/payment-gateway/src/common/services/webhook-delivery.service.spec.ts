// The entity barrel has a circular import (App → Customer → Subscription →
// Plan → App) that swc-jest turns into a temporal-dead-zone error at load.
// This spec only needs the classes as DI tokens, so stub the barrel out —
// same workaround as the worker's processor spec.
jest.mock('../../database/entities', () => ({
  App: class App {},
  Customer: class Customer {},
  Plan: class Plan {},
  Subscription: class Subscription {},
  Transaction: class Transaction {},
  TransactionLog: class TransactionLog {},
  User: class User {},
  WebhookEvent: class WebhookEvent {},
}));
jest.mock('axios');

import axios from 'axios';
import { Repository } from 'typeorm';
import { encryptSecret, hmacSha256 } from '../crypto';
import { LogAction, Provider, TransactionStatus, WebhookDeliveryStatus } from '../enums';
import { App, Transaction, WebhookEvent } from '../../database/entities';
import { TransactionLoggerService } from './transaction-logger.service';
import { WebhookDeliveryService } from './webhook-delivery.service';

const post = axios.post as jest.Mock;
const SECRET = 'whsec_testsecretmaterial';

function app(overrides: Partial<App> = {}): App {
  return {
    id: 'app-1',
    slug: 'savi',
    webhookUrl: 'https://savi.app/hooks/acepay',
    webhookSecretEnc: encryptSecret(SECRET),
    ...overrides,
  } as App;
}

function event(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: 'evt-1',
    appId: 'app-1',
    provider: Provider.Xendit,
    eventType: 'subscription.payment_succeeded',
    providerEventId: 'prov-evt-1',
    normalizedPayload: { id: 'tx-1', status: 'succeeded' },
    deliveryStatus: WebhookDeliveryStatus.Pending,
    attempts: 0,
    maxAttempts: 5,
    ...overrides,
  } as WebhookEvent;
}

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return { id: 'tx-1', status: TransactionStatus.Succeeded, ...overrides } as Transaction;
}

function response(status: number, data: unknown = 'ok') {
  return { status, data };
}

describe('WebhookDeliveryService', () => {
  let webhooks: { save: jest.Mock };
  let txLogger: { log: jest.Mock };
  let service: WebhookDeliveryService;
  const originalKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = 'a'.repeat(64);
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    else process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalKey;
  });

  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue(response(200));
    webhooks = { save: jest.fn((e) => Promise.resolve(e)) };
    txLogger = { log: jest.fn().mockResolvedValue(undefined) };
    service = new WebhookDeliveryService(
      webhooks as unknown as Repository<WebhookEvent>,
      txLogger as unknown as TransactionLoggerService,
    );
  });

  describe('when the app has no webhook URL', () => {
    it('records a failure without attempting a request', async () => {
      const e = event();
      await service.deliver(app({ webhookUrl: null }), e, null);
      expect(post).not.toHaveBeenCalled();
      expect(e.deliveryStatus).toBe(WebhookDeliveryStatus.Failed);
      expect(e.lastResponseStatus).toBe(0);
      expect(e.lastResponseBody).toBe('no_webhook_url_configured');
      expect(webhooks.save).toHaveBeenCalledWith(e);
    });

    it('still counts the attempt and stamps the timestamps', async () => {
      const e = event({ attempts: 1 });
      await service.deliver(app({ webhookUrl: null }), e, null);
      expect(e.attempts).toBe(2);
      expect(e.lastAttemptAt).toBeInstanceOf(Date);
      expect(e.firstAttemptAt).toBe(e.lastAttemptAt);
    });

    it.each([
      ['an empty string', ''],
      ['undefined', undefined],
    ])('treats %s as no URL', async (_label, url) => {
      await service.deliver(app({ webhookUrl: url }), event(), null);
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('when the app has no webhook secret', () => {
    it('throws rather than sending an unsigned payload', async () => {
      await expect(service.deliver(app({ webhookSecretEnc: null }), event(), null))
        .rejects.toThrow('App savi has no webhook secret');
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('the signed request', () => {
    it('posts the serialized normalized payload to the app URL', async () => {
      const e = event();
      await service.deliver(app(), e, null);
      const [url, body, config] = post.mock.calls[0];
      expect(url).toBe('https://savi.app/hooks/acepay');
      expect(body).toBe(JSON.stringify(e.normalizedPayload));
      expect(config.timeout).toBe(10_000);
    });

    it('signs timestamp.body with the decrypted secret', async () => {
      const e = event();
      await service.deliver(app(), e, null);
      const { headers } = post.mock.calls[0][2];
      const body = post.mock.calls[0][1];
      const expected = hmacSha256(SECRET, `${headers['x-acepay-timestamp']}.${body}`);
      expect(headers['x-acepay-signature']).toBe(`sha256=${expected}`);
    });

    it('sends a whole-second unix timestamp', async () => {
      await service.deliver(app(), event(), null);
      const ts = post.mock.calls[0][2].headers['x-acepay-timestamp'];
      expect(ts).toMatch(/^\d+$/);
      expect(Math.abs(Number(ts) - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(2);
    });

    it('identifies the event so the app can dedupe', async () => {
      await service.deliver(app(), event(), null);
      const { headers } = post.mock.calls[0][2];
      expect(headers['x-acepay-event']).toBe('subscription.payment_succeeded');
      expect(headers['x-acepay-event-id']).toBe('evt-1');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('sends {} when there is no normalized payload', async () => {
      await service.deliver(app(), event({ normalizedPayload: null }), null);
      expect(post.mock.calls[0][1]).toBe('{}');
    });

    // A non-2xx must be inspected, not thrown by axios, or the retry/exhaust
    // bookkeeping below never runs.
    it('tells axios not to throw on non-2xx', async () => {
      await service.deliver(app(), event(), null);
      expect(post.mock.calls[0][2].validateStatus()).toBe(true);
    });
  });

  describe('a successful delivery', () => {
    it.each([200, 201, 202, 204, 299])('treats %i as delivered', async (status) => {
      post.mockResolvedValue(response(status));
      const e = event();
      await service.deliver(app(), e, null);
      expect(e.deliveryStatus).toBe(WebhookDeliveryStatus.Delivered);
      expect(e.deliveredAt).toBeInstanceOf(Date);
      expect(e.lastResponseStatus).toBe(status);
    });

    it('marks the transaction notified and logs it', async () => {
      const t = tx();
      const e = event();
      await service.deliver(app(), e, t);
      expect(t.appNotifiedAt).toBe(e.deliveredAt);
      expect(txLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        transaction: t,
        action: LogAction.PaymentAppNotified,
        providerEventId: 'prov-evt-1',
        details: { url: 'https://savi.app/hooks/acepay', status: 200 },
      }));
    });

    it('delivers fine with no transaction attached and logs nothing', async () => {
      const e = event();
      await service.deliver(app(), e, null);
      expect(e.deliveryStatus).toBe(WebhookDeliveryStatus.Delivered);
      expect(txLogger.log).not.toHaveBeenCalled();
    });

    it('does not change the transaction status when notifying', async () => {
      const t = tx({ status: TransactionStatus.Succeeded });
      await service.deliver(app(), event(), t);
      const call = txLogger.log.mock.calls[0][0];
      expect(call.statusFrom).toBe(TransactionStatus.Succeeded);
      expect(call.statusTo).toBe(TransactionStatus.Succeeded);
      expect(t.status).toBe(TransactionStatus.Succeeded);
    });
  });

  describe('a rejected delivery', () => {
    it.each([100, 199, 300, 301, 400, 401, 404, 500, 502])(
      'treats %i as not delivered',
      async (status) => {
        post.mockResolvedValue(response(status));
        const e = event();
        await service.deliver(app(), e, null);
        expect(e.deliveryStatus).not.toBe(WebhookDeliveryStatus.Delivered);
        expect(e.deliveredAt).toBeUndefined();
      },
    );

    it('stays retryable while attempts remain', async () => {
      post.mockResolvedValue(response(500));
      const e = event({ attempts: 0, maxAttempts: 5 });
      await service.deliver(app(), e, tx());
      expect(e.deliveryStatus).toBe(WebhookDeliveryStatus.Failed);
      expect(txLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: LogAction.PaymentAppNotifyRetry,
        details: expect.objectContaining({ attempts: 1, reason: 'non-2xx: 500' }),
      }));
    });

    it('is exhausted once the attempt count reaches maxAttempts', async () => {
      post.mockResolvedValue(response(500));
      const e = event({ attempts: 4, maxAttempts: 5 });
      await service.deliver(app(), e, tx());
      expect(e.attempts).toBe(5);
      expect(e.deliveryStatus).toBe(WebhookDeliveryStatus.Exhausted);
      expect(txLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: LogAction.PaymentAppNotifyFailed,
      }));
    });

    it('is still retryable on the attempt just before the last', async () => {
      post.mockResolvedValue(response(500));
      const e = event({ attempts: 3, maxAttempts: 5 });
      await service.deliver(app(), e, tx());
      expect(e.deliveryStatus).toBe(WebhookDeliveryStatus.Failed);
    });

    it('exhausts immediately when maxAttempts is 1', async () => {
      post.mockResolvedValue(response(500));
      const e = event({ attempts: 0, maxAttempts: 1 });
      await service.deliver(app(), e, null);
      expect(e.deliveryStatus).toBe(WebhookDeliveryStatus.Exhausted);
    });

    it('records the failure without a transaction to log against', async () => {
      post.mockResolvedValue(response(500));
      const e = event();
      await service.deliver(app(), e, null);
      expect(e.deliveryStatus).toBe(WebhookDeliveryStatus.Failed);
      expect(txLogger.log).not.toHaveBeenCalled();
    });
  });

  describe('a transport error', () => {
    it('records status 0 and the error message instead of propagating', async () => {
      post.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.1:443'));
      const e = event();
      await expect(service.deliver(app(), e, null)).resolves.toBeUndefined();
      expect(e.lastResponseStatus).toBe(0);
      expect(e.lastResponseBody).toBe('ECONNREFUSED 10.0.0.1:443');
      expect(e.deliveryStatus).toBe(WebhookDeliveryStatus.Failed);
    });

    it('handles a non-Error rejection', async () => {
      post.mockRejectedValue('socket hang up');
      const e = event();
      await service.deliver(app(), e, null);
      expect(e.lastResponseBody).toBe('socket hang up');
    });

    it('exhausts on a transport error on the final attempt', async () => {
      post.mockRejectedValue(new Error('timeout of 10000ms exceeded'));
      const e = event({ attempts: 4, maxAttempts: 5 });
      await service.deliver(app(), e, tx());
      expect(e.deliveryStatus).toBe(WebhookDeliveryStatus.Exhausted);
    });

    it('persists the event even though the request threw', async () => {
      post.mockRejectedValue(new Error('boom'));
      const e = event();
      await service.deliver(app(), e, null);
      expect(webhooks.save).toHaveBeenCalledWith(e);
    });
  });

  describe('response body capture', () => {
    it('truncates a huge string body to 4000 characters', async () => {
      post.mockResolvedValue(response(500, 'x'.repeat(10_000)));
      const e = event();
      await service.deliver(app(), e, null);
      expect(e.lastResponseBody).toHaveLength(4000);
    });

    it('serializes an object body', async () => {
      post.mockResolvedValue(response(200, { ok: true, id: 7 }));
      const e = event();
      await service.deliver(app(), e, null);
      expect(e.lastResponseBody).toBe('{"ok":true,"id":7}');
    });

    it('truncates a huge object body too', async () => {
      post.mockResolvedValue(response(200, { blob: 'y'.repeat(10_000) }));
      const e = event();
      await service.deliver(app(), e, null);
      expect(e.lastResponseBody).toHaveLength(4000);
    });

    it('truncates a long transport error message', async () => {
      post.mockRejectedValue(new Error('z'.repeat(10_000)));
      const e = event();
      await service.deliver(app(), e, null);
      expect(e.lastResponseBody).toHaveLength(4000);
    });
  });

  describe('attempt bookkeeping', () => {
    it('increments attempts once per delivery', async () => {
      const e = event({ attempts: 2 });
      await service.deliver(app(), e, null);
      expect(e.attempts).toBe(3);
    });

    it('keeps the original firstAttemptAt across retries', async () => {
      const first = new Date('2026-01-01T00:00:00Z');
      const e = event({ attempts: 1, firstAttemptAt: first });
      await service.deliver(app(), e, null);
      expect(e.firstAttemptAt).toBe(first);
      expect(e.lastAttemptAt).not.toBe(first);
    });

    it('sets firstAttemptAt on the very first attempt', async () => {
      const e = event({ attempts: 0, firstAttemptAt: null });
      await service.deliver(app(), e, null);
      expect(e.firstAttemptAt).toBe(e.lastAttemptAt);
    });

    it('saves the event exactly once per delivery', async () => {
      await service.deliver(app(), event(), null);
      expect(webhooks.save).toHaveBeenCalledTimes(1);
    });
  });
});
