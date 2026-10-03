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

import { LessThan, Repository } from 'typeorm';
import { LogAction, LogActor, Provider, TransactionStatus, WebhookDeliveryStatus } from '../enums';
import { App, Transaction, WebhookEvent } from '../../database/entities';
import { ProviderRegistry } from '../../payment-providers/provider.registry';
import { WebhookDeliveryQueueService } from '../queue/webhook-delivery-queue.service';
import { TransactionLoggerService } from './transaction-logger.service';
import { PaymentReconcilerService } from './payment-reconciler.service';

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    appId: 'app-1',
    provider: Provider.Xendit,
    providerTxId: 'inv-1',
    status: TransactionStatus.Pending,
    amount: 49900,
    currency: 'PHP',
    metadata: { userId: 'u1' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Transaction;
}

describe('PaymentReconcilerService', () => {
  let transactions: { save: jest.Mock; find: jest.Mock };
  let webhooks: { create: jest.Mock; save: jest.Mock };
  let apps: { findOne: jest.Mock };
  let getPayment: jest.Mock;
  let providers: { resolve: jest.Mock };
  let txLogger: { log: jest.Mock };
  let deliveryQueue: { enqueue: jest.Mock };
  let service: PaymentReconcilerService;

  beforeEach(() => {
    transactions = { save: jest.fn((t) => Promise.resolve(t)), find: jest.fn().mockResolvedValue([]) };
    webhooks = {
      create: jest.fn((e) => e),
      save: jest.fn((e) => Promise.resolve({ id: 'evt-new', ...e })),
    };
    apps = { findOne: jest.fn().mockResolvedValue({ id: 'app-1', webhookUrl: 'https://savi.app/hook' } as App) };
    getPayment = jest.fn();
    providers = { resolve: jest.fn().mockReturnValue({ getPayment }) };
    txLogger = { log: jest.fn().mockResolvedValue(undefined) };
    deliveryQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    service = new PaymentReconcilerService(
      transactions as unknown as Repository<Transaction>,
      webhooks as unknown as Repository<WebhookEvent>,
      apps as unknown as Repository<App>,
      providers as unknown as ProviderRegistry,
      txLogger as unknown as TransactionLoggerService,
      deliveryQueue as unknown as WebhookDeliveryQueueService,
    );
  });

  describe('when there is nothing to reconcile against', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['an empty string', ''],
    ])('bails out when providerTxId is %s', async (_label, providerTxId) => {
      const t = tx({ providerTxId } as Partial<Transaction>);
      const result = await service.reconcile(t);
      expect(result).toEqual({
        transactionId: 'tx-1',
        before: TransactionStatus.Pending,
        after: TransactionStatus.Pending,
        changed: false,
        notifiedApp: false,
        reason: 'no_provider_tx_id',
      });
      expect(providers.resolve).not.toHaveBeenCalled();
      expect(transactions.save).not.toHaveBeenCalled();
    });
  });

  describe('marketplace payments (Slice 6)', () => {
    it("reads the invoice on the merchant's Xendit sub-account", async () => {
      getPayment.mockResolvedValue({ status: TransactionStatus.Pending });
      await service.reconcile(tx({ providerAccountId: 'sub-1' } as Partial<Transaction>));
      expect(getPayment).toHaveBeenCalledWith('inv-1', { forUserId: 'sub-1' });
    });

    it('keeps the plain call for non-marketplace payments', async () => {
      getPayment.mockResolvedValue({ status: TransactionStatus.Pending });
      await service.reconcile(tx());
      expect(getPayment).toHaveBeenCalledWith('inv-1');
    });
  });

  describe('when the provider lookup fails', () => {
    it('reports the error without touching the transaction', async () => {
      getPayment.mockRejectedValue(new Error('invoice not found'));
      const t = tx();
      const result = await service.reconcile(t);
      expect(result.reason).toBe('provider_error: invoice not found');
      expect(result.changed).toBe(false);
      expect(t.status).toBe(TransactionStatus.Pending);
      expect(transactions.save).not.toHaveBeenCalled();
      expect(txLogger.log).not.toHaveBeenCalled();
    });

    it('handles a non-Error rejection', async () => {
      getPayment.mockRejectedValue('gateway timeout');
      const result = await service.reconcile(tx());
      expect(result.reason).toBe('provider_error: gateway timeout');
    });

    it('does not enqueue a webhook delivery', async () => {
      getPayment.mockRejectedValue(new Error('boom'));
      await service.reconcile(tx());
      expect(deliveryQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('when the provider agrees with our state', () => {
    it('is a no-op', async () => {
      getPayment.mockResolvedValue({ status: TransactionStatus.Pending });
      const result = await service.reconcile(tx());
      expect(result).toEqual({
        transactionId: 'tx-1',
        before: TransactionStatus.Pending,
        after: TransactionStatus.Pending,
        changed: false,
        notifiedApp: false,
      });
      expect(transactions.save).not.toHaveBeenCalled();
      expect(txLogger.log).not.toHaveBeenCalled();
      expect(deliveryQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('when the provider has moved on', () => {
    it.each([
      [TransactionStatus.Succeeded, LogAction.PaymentSucceeded, 'payment.succeeded'],
      [TransactionStatus.Failed, LogAction.PaymentFailed, 'payment.failed'],
      [TransactionStatus.Refunded, LogAction.PaymentRefunded, 'refund.succeeded'],
    ])('applies %s, logs %s and synthesizes %s', async (status, action, eventName) => {
      getPayment.mockResolvedValue({ status, raw: { id: 'inv-1' } });
      const t = tx();
      const result = await service.reconcile(t);

      expect(t.status).toBe(status);
      expect(transactions.save).toHaveBeenCalledWith(t);
      expect(txLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        transaction: t,
        action,
        statusFrom: TransactionStatus.Pending,
        statusTo: status,
        details: { source: 'reconcile', providerStatus: status },
      }));
      expect(webhooks.create).toHaveBeenCalledWith(expect.objectContaining({
        eventType: eventName,
        deliveryStatus: WebhookDeliveryStatus.Pending,
      }));
      expect(result).toMatchObject({ changed: true, after: status, notifiedApp: true });
    });

    // Canceled has no outbound event name, but the status change and audit log
    // must still happen — otherwise a canceled payment stays Pending forever.
    it('records a status with no outbound event without notifying the app', async () => {
      getPayment.mockResolvedValue({ status: TransactionStatus.Canceled });
      const t = tx();
      const result = await service.reconcile(t);
      expect(t.status).toBe(TransactionStatus.Canceled);
      expect(transactions.save).toHaveBeenCalled();
      expect(txLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: LogAction.PaymentWebhookReceived,
      }));
      expect(webhooks.create).not.toHaveBeenCalled();
      expect(result).toMatchObject({ changed: true, notifiedApp: false });
    });

    it('marks how we learned about it, not pretending a webhook arrived earlier', async () => {
      getPayment.mockResolvedValue({ status: TransactionStatus.Succeeded });
      const t = tx({ webhookReceivedAt: null });
      await service.reconcile(t);
      expect(t.webhookReceivedAt).toBeInstanceOf(Date);
    });

    it('never overwrites an existing webhookReceivedAt', async () => {
      const original = new Date('2026-01-02T00:00:00Z');
      getPayment.mockResolvedValue({ status: TransactionStatus.Succeeded });
      const t = tx({ webhookReceivedAt: original });
      await service.reconcile(t);
      expect(t.webhookReceivedAt).toBe(original);
    });

    it('takes providerCompletedAt from the provider when we have none', async () => {
      const completed = new Date('2026-01-03T00:00:00Z');
      getPayment.mockResolvedValue({ status: TransactionStatus.Succeeded, providerCompletedAt: completed });
      const t = tx({ providerCompletedAt: null });
      await service.reconcile(t);
      expect(t.providerCompletedAt).toBe(completed);
    });

    it('keeps our providerCompletedAt when we already have one', async () => {
      const ours = new Date('2026-01-01T12:00:00Z');
      getPayment.mockResolvedValue({
        status: TransactionStatus.Succeeded,
        providerCompletedAt: new Date('2026-01-09T00:00:00Z'),
      });
      const t = tx({ providerCompletedAt: ours });
      await service.reconcile(t);
      expect(t.providerCompletedAt).toBe(ours);
    });

    it('leaves providerCompletedAt alone when the provider does not report one', async () => {
      getPayment.mockResolvedValue({ status: TransactionStatus.Succeeded });
      const t = tx({ providerCompletedAt: null });
      await service.reconcile(t);
      expect(t.providerCompletedAt).toBeNull();
    });

    it('passes the actor through to the audit log', async () => {
      getPayment.mockResolvedValue({ status: TransactionStatus.Succeeded });
      await service.reconcile(tx(), LogActor.Admin);
      expect(txLogger.log.mock.calls[0][0].actor).toBe(LogActor.Admin);
    });

    it('defaults the actor to the system', async () => {
      getPayment.mockResolvedValue({ status: TransactionStatus.Succeeded });
      await service.reconcile(tx());
      expect(txLogger.log.mock.calls[0][0].actor).toBe(LogActor.System);
    });

    it('resolves the adapter for the transaction provider', async () => {
      getPayment.mockResolvedValue({ status: TransactionStatus.Succeeded });
      await service.reconcile(tx({ provider: Provider.Lemonsqueezy }));
      expect(providers.resolve).toHaveBeenCalledWith(Provider.Lemonsqueezy);
      expect(getPayment).toHaveBeenCalledWith('inv-1');
    });
  });

  describe('the synthesized webhook event', () => {
    beforeEach(() => getPayment.mockResolvedValue({
      status: TransactionStatus.Succeeded,
      raw: { provider: 'raw-payload' },
    }));

    it('is tagged as reconcile-sourced and traceable to the transaction', async () => {
      await service.reconcile(tx());
      const created = webhooks.create.mock.calls[0][0];
      expect(created.providerEventId).toMatch(/^acepay_reconcile_tx-1_\d+$/);
      expect(created.providerPayload).toEqual({ source: 'reconcile', providerRaw: { provider: 'raw-payload' } });
      expect(created.transactionId).toBe('tx-1');
      expect(created.appId).toBe('app-1');
      expect(created.provider).toBe(Provider.Xendit);
    });

    it('carries the amount, currency and metadata the app needs', async () => {
      await service.reconcile(tx());
      expect(webhooks.create.mock.calls[0][0].normalizedPayload).toMatchObject({
        event: 'payment.succeeded',
        transaction_id: 'tx-1',
        amount: 49900,
        currency: 'PHP',
        metadata: { userId: 'u1' },
        source: 'reconcile',
      });
    });

    it('enqueues the saved event id, not the unsaved draft', async () => {
      await service.reconcile(tx());
      expect(deliveryQueue.enqueue).toHaveBeenCalledWith({ webhookEventId: 'evt-new', transactionId: 'tx-1' });
    });

    it('is skipped when the app has no webhook URL configured', async () => {
      apps.findOne.mockResolvedValue({ id: 'app-1', webhookUrl: null } as App);
      const result = await service.reconcile(tx());
      expect(webhooks.create).not.toHaveBeenCalled();
      expect(deliveryQueue.enqueue).not.toHaveBeenCalled();
      // The status change still stands.
      expect(result).toMatchObject({ changed: true, notifiedApp: false });
    });

    it('is skipped when the app row is gone', async () => {
      apps.findOne.mockResolvedValue(null);
      const result = await service.reconcile(tx());
      expect(deliveryQueue.enqueue).not.toHaveBeenCalled();
      expect(result.notifiedApp).toBe(false);
    });

    // appId is NOT NULL in the schema, so the reconciler's `&& tx.appId` guard
    // can only be hit by a falsy string — an unsaved or partially-hydrated row.
    it('is skipped when the transaction has no app id', async () => {
      const result = await service.reconcile(tx({ appId: '' }));
      expect(apps.findOne).not.toHaveBeenCalled();
      expect(result).toMatchObject({ changed: true, notifiedApp: false });
    });
  });

  describe('reconcileStale', () => {
    it('selects only pending transactions older than the cutoff, oldest first', async () => {
      await service.reconcileStale(300, 10);
      const query = transactions.find.mock.calls[0][0];
      expect(query.where.status).toBe(TransactionStatus.Pending);
      expect(query.where.createdAt).toEqual(LessThan(expect.any(Date) as unknown as Date));
      expect(query.order).toEqual({ createdAt: 'ASC' });
      expect(query.take).toBe(10);
    });

    it('honours the staleness window', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-01T12:00:00Z'));
      await service.reconcileStale(600);
      const cutoff = transactions.find.mock.calls[0][0].where.createdAt.value as Date;
      expect(cutoff.toISOString()).toBe('2026-06-01T11:50:00.000Z');
      jest.useRealTimers();
    });

    it('defaults to a 120s window and a 50-row cap', async () => {
      await service.reconcileStale();
      expect(transactions.find.mock.calls[0][0].take).toBe(50);
    });

    it('returns an empty list when nothing is stale', async () => {
      transactions.find.mockResolvedValue([]);
      await expect(service.reconcileStale()).resolves.toEqual([]);
    });

    it('reconciles every stale row', async () => {
      transactions.find.mockResolvedValue([tx({ id: 'tx-1' }), tx({ id: 'tx-2' })]);
      getPayment.mockResolvedValue({ status: TransactionStatus.Succeeded });
      const out = await service.reconcileStale();
      expect(out.map((r) => r.transactionId)).toEqual(['tx-1', 'tx-2']);
      expect(out.every((r) => r.changed)).toBe(true);
    });

    // One poisoned row must not abandon the rest of the batch.
    it('keeps going when one transaction blows up, recording why', async () => {
      transactions.find.mockResolvedValue([tx({ id: 'tx-1' }), tx({ id: 'tx-2' })]);
      providers.resolve
        .mockImplementationOnce(() => { throw new Error('no adapter for provider'); })
        .mockReturnValue({ getPayment });
      getPayment.mockResolvedValue({ status: TransactionStatus.Succeeded });

      const out = await service.reconcileStale();
      expect(out).toHaveLength(2);
      expect(out[0]).toMatchObject({
        transactionId: 'tx-1', changed: false, reason: 'no adapter for provider',
      });
      expect(out[1]).toMatchObject({ transactionId: 'tx-2', changed: true });
    });

    it('records a non-Error throw as its string form', async () => {
      transactions.find.mockResolvedValue([tx()]);
      providers.resolve.mockImplementationOnce(() => { throw 'registry offline'; });
      const out = await service.reconcileStale();
      expect(out[0].reason).toBe('registry offline');
    });
  });
});
