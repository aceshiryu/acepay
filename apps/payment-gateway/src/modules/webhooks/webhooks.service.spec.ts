// The entity barrel has a circular import (App → Customer → Subscription →
// Plan → App) that swc-jest turns into a temporal-dead-zone error at load.
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

import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  LogAction, LogActor, PlanInterval, Provider, SubscriptionStatus,
  TransactionStatus, TransactionType, WebhookDeliveryStatus, XenditPaymentMethodStatus,
} from '../../common/enums';
import { SubscriptionBillingQueueService } from '../../common/queue/subscription-billing-queue.service';
import { WebhookDeliveryQueueService } from '../../common/queue/webhook-delivery-queue.service';
import { TransactionLoggerService } from '../../common/services/transaction-logger.service';
import { App, Customer, Subscription, Transaction, WebhookEvent } from '../../database/entities';
import { ProviderRegistry } from '../../payment-providers/provider.registry';
import { NormalizedEvent } from '../../payment-providers/provider.types';
import { WebhooksService } from './webhooks.service';

const BODY = Buffer.from('{}');

// AcePay ids are uuid columns, so fixtures must be real uuids — a slug like
// TX_ID is not something the gateway could ever store.
const TX_ID = '3f8a1c2e-4b5d-6e7f-8a9b-0c1d2e3f4a5b';
const SUB_ID = '7b2d4e6f-1a3c-5d7e-9f0a-2b4c6d8e0f1a';

function paymentEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    event: 'payment.succeeded',
    providerEventId: 'evt-1',
    providerTxId: '9001',
    providerSubscriptionId: null,
    acepayTxId: TX_ID,
    acepaySubscriptionId: null,
    status: TransactionStatus.Succeeded,
    provider: Provider.Lemonsqueezy,
    raw: {},
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as NormalizedEvent;
}

function subEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return paymentEvent({
    event: 'subscription.created',
    providerTxId: null,
    acepayTxId: null,
    acepaySubscriptionId: SUB_ID,
    providerSubscriptionId: 'prov-sub-1',
    subscriptionStatus: SubscriptionStatus.Active,
    status: null,
    ...overrides,
  } as Partial<NormalizedEvent>);
}

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: TX_ID, appId: 'app-1', provider: Provider.Lemonsqueezy,
    providerTxId: 'chk-uuid', status: TransactionStatus.Pending,
    amount: 49900, currency: 'PHP', createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Transaction;
}

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: SUB_ID, appId: 'app-1', customerId: 'cus-1',
    provider: Provider.Lemonsqueezy, providerSubscriptionId: 'chk-1',
    status: SubscriptionStatus.Active, metadata: {},
    plan: { amount: 49900, currency: 'PHP', name: 'Pro', interval: PlanInterval.Monthly, intervalCount: 1 },
    ...overrides,
  } as Subscription;
}

describe('WebhooksService (/v1/webhooks/*)', () => {
  let webhooks: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let transactions: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let subscriptions: { findOne: jest.Mock; save: jest.Mock };
  let customers: { findOne: jest.Mock; save: jest.Mock };
  let apps: { findOne: jest.Mock };
  let adapter: { verifyWebhook: jest.Mock; normalizeEvent: jest.Mock };
  let providers: { resolve: jest.Mock };
  let chargeWithPaymentMethod: jest.Mock;
  let txLogger: { log: jest.Mock };
  let deliveryQueue: { enqueue: jest.Mock };
  let billingQueue: { enqueue: jest.Mock };
  let service: WebhooksService;

  beforeEach(() => {
    webhooks = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((e) => e),
      save: jest.fn((e) => Promise.resolve({ id: 'evt-row-1', ...e })),
    };
    transactions = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((t) => t),
      save: jest.fn((t) => Promise.resolve({ id: 'tx-new', ...t })),
    };
    subscriptions = { findOne: jest.fn().mockResolvedValue(null), save: jest.fn((s) => Promise.resolve(s)) };
    customers = { findOne: jest.fn().mockResolvedValue(null), save: jest.fn((c) => Promise.resolve(c)) };
    apps = { findOne: jest.fn().mockResolvedValue({ id: 'app-1', slug: 'savi' } as App) };
    adapter = {
      verifyWebhook: jest.fn().mockReturnValue({}),
      normalizeEvent: jest.fn().mockReturnValue(paymentEvent()),
    };
    chargeWithPaymentMethod = jest.fn().mockResolvedValue({
      paymentRequestId: 'pr-1', status: 'SUCCEEDED', raw: {},
    });
    providers = { resolve: jest.fn().mockReturnValue({ ...adapter, chargeWithPaymentMethod }) };
    txLogger = { log: jest.fn().mockResolvedValue(undefined) };
    deliveryQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    billingQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    service = new WebhooksService(
      webhooks as unknown as Repository<WebhookEvent>,
      transactions as unknown as Repository<Transaction>,
      subscriptions as unknown as Repository<Subscription>,
      customers as unknown as Repository<Customer>,
      apps as unknown as Repository<App>,
      providers as unknown as ProviderRegistry,
      txLogger as unknown as TransactionLoggerService,
      deliveryQueue as unknown as WebhookDeliveryQueueService,
      billingQueue as unknown as SubscriptionBillingQueueService,
    );
  });

  describe('signature verification', () => {
    // A bad signature is a client error, not a 500 — otherwise the provider
    // keeps retrying and the logs fill with stack traces.
    it('turns a verification failure into a 400', async () => {
      adapter.verifyWebhook.mockImplementation(() => { throw new Error('Invalid signature'); });
      try {
        await service.handle(Provider.Lemonsqueezy, BODY, 'bad-sig');
        throw new Error('expected a throw');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).getResponse()).toEqual({
          error: 'invalid_signature', message: 'Invalid signature',
        });
      }
      expect(webhooks.save).not.toHaveBeenCalled();
    });

    it('wraps a non-Error verification failure', async () => {
      adapter.verifyWebhook.mockImplementation(() => { throw 'nope'; });
      await expect(service.handle(Provider.Xendit, BODY, 'x')).rejects.toThrow('nope');
    });

    it('verifies with the adapter for the named provider', async () => {
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(providers.resolve).toHaveBeenCalledWith(Provider.Xendit);
      expect(adapter.verifyWebhook).toHaveBeenCalledWith(BODY, 'tok');
    });
  });

  // Providers retry aggressively; processing the same event twice would
  // double-charge history and re-notify the app.
  describe('idempotency', () => {
    it('short-circuits a duplicate event without touching any state', async () => {
      webhooks.findOne.mockResolvedValue({ id: 'existing-evt' });
      const res = await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(res).toEqual({ duplicate: true, eventId: 'existing-evt' });
      expect(transactions.save).not.toHaveBeenCalled();
      expect(webhooks.save).not.toHaveBeenCalled();
      expect(deliveryQueue.enqueue).not.toHaveBeenCalled();
    });

    it('dedupes on the provider + provider event id pair', async () => {
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(webhooks.findOne).toHaveBeenCalledWith({
        where: { provider: Provider.Lemonsqueezy, providerEventId: 'evt-1' },
      });
    });
  });

  describe('routing', () => {
    it.each([
      ['an event named subscription.*', { event: 'subscription.updated', acepaySubscriptionId: null, providerSubscriptionId: null }],
      ['an AcePay subscription id', { event: 'payment.succeeded', acepaySubscriptionId: SUB_ID }],
      ['a provider subscription id', { event: 'payment.succeeded', providerSubscriptionId: 'prov-1' }],
    ])('routes to the subscription path for %s', async (_label, overrides) => {
      adapter.normalizeEvent.mockReturnValue(paymentEvent(overrides as Partial<NormalizedEvent>));
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      // The tell is that the payment path never ran — a name-only subscription
      // event with no ids resolves to null without querying at all.
      expect(transactions.findOne).not.toHaveBeenCalled();
    });

    it('routes a plain payment event to the payment path', async () => {
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(subscriptions.findOne).not.toHaveBeenCalled();
      expect(transactions.findOne).toHaveBeenCalled();
    });
  });

  describe('payment events', () => {
    it('resolves the transaction by AcePay id first', async () => {
      transactions.findOne.mockResolvedValue(tx());
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(transactions.findOne).toHaveBeenNthCalledWith(1, { where: { id: TX_ID } });
    });

    it('falls back to the provider id scoped by provider', async () => {
      adapter.normalizeEvent.mockReturnValue(paymentEvent({ acepayTxId: null }));
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(transactions.findOne).toHaveBeenCalledWith({
        where: { providerTxId: '9001', provider: Provider.Lemonsqueezy },
      });
    });

    it('falls back to the provider id when the AcePay id matches nothing', async () => {
      transactions.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(tx());
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(transactions.findOne).toHaveBeenCalledTimes(2);
    });

    // A provider payload can carry anything in custom_data. A non-uuid reference
    // must simply not match: querying a uuid column with it makes Postgres raise,
    // which turned a malformed webhook into a 500 on a public endpoint.
    it.each([
      ['a prefixed uuid', `sim_${TX_ID}`],
      ['an arbitrary string', 'not-a-uuid'],
      ['an empty string', ''],
      ['a numeric id', '9001'],
    ])('does not query the transactions table for %s', async (_label, acepayTxId) => {
      adapter.normalizeEvent.mockReturnValue(paymentEvent({ acepayTxId, providerTxId: null }));
      await expect(service.handle(Provider.Lemonsqueezy, BODY, 'sig')).resolves.toBeDefined();
      expect(transactions.findOne).not.toHaveBeenCalled();
    });

    it('still accepts a well-formed uuid reference', async () => {
      const id = TX_ID;
      adapter.normalizeEvent.mockReturnValue(paymentEvent({ acepayTxId: id }));
      transactions.findOne.mockResolvedValue(tx({ id }));
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(transactions.findOne).toHaveBeenNthCalledWith(1, { where: { id } });
    });

    it('falls through to the provider id when the AcePay reference is malformed', async () => {
      adapter.normalizeEvent.mockReturnValue(paymentEvent({ acepayTxId: 'sim_nonsense', providerTxId: '9001' }));
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(transactions.findOne).toHaveBeenCalledWith({
        where: { providerTxId: '9001', provider: Provider.Lemonsqueezy },
      });
    });

    it('applies the new status and stamps the webhook time', async () => {
      const t = tx({ status: TransactionStatus.Pending });
      transactions.findOne.mockResolvedValue(t);
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(t.status).toBe(TransactionStatus.Succeeded);
      expect(t.webhookReceivedAt).toBeInstanceOf(Date);
      expect(transactions.save).toHaveBeenCalledWith(t);
    });

    it('does nothing when the status already matches', async () => {
      transactions.findOne.mockResolvedValue(tx({ status: TransactionStatus.Succeeded }));
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(transactions.save).not.toHaveBeenCalled();
      expect(txLogger.log).not.toHaveBeenCalled();
    });

    // The LS gotcha: providerTxId starts as a checkout UUID and must become the
    // numeric order id, or refunds and getPayment hit the wrong API.
    it('swaps the checkout id for the order id', async () => {
      const t = tx({ providerTxId: 'chk-uuid' });
      transactions.findOne.mockResolvedValue(t);
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(t.providerTxId).toBe('9001');
    });

    it('leaves the provider id alone when the event carries none', async () => {
      adapter.normalizeEvent.mockReturnValue(paymentEvent({ providerTxId: null }));
      const t = tx({ providerTxId: 'chk-uuid' });
      transactions.findOne.mockResolvedValue(t);
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(t.providerTxId).toBe('chk-uuid');
    });

    it.each([
      [TransactionStatus.Succeeded],
      [TransactionStatus.Refunded],
    ])('sets providerCompletedAt for a %s outcome', async (status) => {
      adapter.normalizeEvent.mockReturnValue(paymentEvent({ status }));
      const t = tx({ providerCompletedAt: null });
      transactions.findOne.mockResolvedValue(t);
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(t.providerCompletedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('never overwrites an existing providerCompletedAt', async () => {
      const original = new Date('2025-12-31T00:00:00Z');
      const t = tx({ providerCompletedAt: original });
      transactions.findOne.mockResolvedValue(t);
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(t.providerCompletedAt).toBe(original);
    });

    it('does not set a completion time for a failure', async () => {
      adapter.normalizeEvent.mockReturnValue(paymentEvent({
        event: 'payment.failed', status: TransactionStatus.Failed,
      }));
      const t = tx({ providerCompletedAt: null });
      transactions.findOne.mockResolvedValue(t);
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(t.providerCompletedAt).toBeNull();
    });

    it.each([
      ['payment.succeeded', LogAction.PaymentSucceeded],
      ['payment.failed', LogAction.PaymentFailed],
      ['refund.succeeded', LogAction.PaymentRefunded],
    ])('audits %s as %s on top of the receipt log', async (event, action) => {
      adapter.normalizeEvent.mockReturnValue(paymentEvent({
        event, status: TransactionStatus.Refunded,
      }));
      transactions.findOne.mockResolvedValue(tx());
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      const actions = txLogger.log.mock.calls.map((c) => c[0].action);
      expect(actions).toEqual([LogAction.PaymentWebhookReceived, action]);
      expect(txLogger.log.mock.calls[0][0].actor).toBe(LogActor.Provider);
    });

    it('logs only the receipt for an event with no status mapping', async () => {
      adapter.normalizeEvent.mockReturnValue(paymentEvent({ event: 'payment.pending' }));
      transactions.findOne.mockResolvedValue(tx());
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(txLogger.log.mock.calls.map((c) => c[0].action))
        .toEqual([LogAction.PaymentWebhookReceived]);
    });
  });

  describe('subscription events', () => {
    it('resolves by AcePay subscription id first, hydrating the plan', async () => {
      adapter.normalizeEvent.mockReturnValue(subEvent());
      subscriptions.findOne.mockResolvedValue(sub());
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(subscriptions.findOne).toHaveBeenNthCalledWith(1, {
        where: { id: SUB_ID }, relations: { plan: true },
      });
    });

    it('ignores a malformed AcePay subscription reference', async () => {
      adapter.normalizeEvent.mockReturnValue(subEvent({
        acepaySubscriptionId: 'sim_not-a-uuid', providerSubscriptionId: 'prov-sub-1',
      }));
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      // Only the provider-id lookup should run; the uuid lookup is skipped.
      expect(subscriptions.findOne).toHaveBeenCalledTimes(1);
      expect(subscriptions.findOne).toHaveBeenCalledWith({
        where: { providerSubscriptionId: 'prov-sub-1', provider: Provider.Lemonsqueezy },
        relations: { plan: true },
      });
    });

    it('falls back to the provider subscription id scoped by provider', async () => {
      adapter.normalizeEvent.mockReturnValue(subEvent({ acepaySubscriptionId: null }));
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(subscriptions.findOne).toHaveBeenCalledWith({
        where: { providerSubscriptionId: 'prov-sub-1', provider: Provider.Lemonsqueezy },
        relations: { plan: true },
      });
    });

    // The row is created holding the CHECKOUT id; the first webhook is what
    // turns it into a real provider subscription id.
    it('swaps the placeholder checkout id for the real subscription id', async () => {
      adapter.normalizeEvent.mockReturnValue(subEvent());
      const s = sub({ providerSubscriptionId: 'chk-1' });
      subscriptions.findOne.mockResolvedValue(s);
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(s.providerSubscriptionId).toBe('prov-sub-1');
      expect(subscriptions.save).toHaveBeenCalledWith(s);
    });

    it('clears the awaiting-first-payment flags once confirmed', async () => {
      adapter.normalizeEvent.mockReturnValue(subEvent());
      const s = sub({ metadata: { awaitingFirstPayment: true, checkoutUrl: 'https://pay/x', tier: 'pro' } });
      subscriptions.findOne.mockResolvedValue(s);
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(s.metadata).toEqual({ tier: 'pro' });
    });

    // provider_subscription_id is UNIQUE, and this is a public endpoint — a raw
    // constraint violation here becomes a 500 the provider retries forever.
    it('skips the id swap when another subscription already holds that id', async () => {
      adapter.normalizeEvent.mockReturnValue(subEvent());
      const s2 = sub({ providerSubscriptionId: 'chk-1' });
      subscriptions.findOne
        .mockResolvedValueOnce(s2)                                  // resolve the sub
        .mockResolvedValueOnce(sub({ id: 'other-sub' }));           // the clash
      await expect(service.handle(Provider.Lemonsqueezy, BODY, 'sig')).resolves.toBeDefined();
      expect(s2.providerSubscriptionId).toBe('chk-1');
    });

    it('still swaps when the only holder is this same subscription', async () => {
      adapter.normalizeEvent.mockReturnValue(subEvent());
      const s3 = sub({ providerSubscriptionId: 'chk-1' });
      subscriptions.findOne.mockResolvedValueOnce(s3).mockResolvedValueOnce(s3);
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(s3.providerSubscriptionId).toBe('prov-sub-1');
    });

    it('applies a status change from the event', async () => {
      adapter.normalizeEvent.mockReturnValue(subEvent({
        event: 'subscription.paused', subscriptionStatus: SubscriptionStatus.Paused,
      }));
      const s = sub({ status: SubscriptionStatus.Active });
      subscriptions.findOne.mockResolvedValue(s);
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(s.status).toBe(SubscriptionStatus.Paused);
    });

    it('reads the next renewal date out of the raw payload', async () => {
      adapter.normalizeEvent.mockReturnValue(subEvent({
        raw: { data: { attributes: { renews_at: '2026-02-01T00:00:00Z' } } },
      }));
      const s = sub({ currentPeriodStart: null });
      subscriptions.findOne.mockResolvedValue(s);
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(s.currentPeriodEnd?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
      expect(s.currentPeriodStart).toBeInstanceOf(Date);
    });

    it('stamps canceledAt once, on the first cancel event', async () => {
      adapter.normalizeEvent.mockReturnValue(subEvent({
        event: 'subscription.canceled', subscriptionStatus: SubscriptionStatus.Canceled,
      }));
      const s = sub({ canceledAt: null });
      subscriptions.findOne.mockResolvedValue(s);
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(s.canceledAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('does not overwrite an existing canceledAt', async () => {
      const original = new Date('2025-12-01T00:00:00Z');
      adapter.normalizeEvent.mockReturnValue(subEvent({
        event: 'subscription.canceled', subscriptionStatus: SubscriptionStatus.Canceled,
      }));
      const s = sub({ canceledAt: original });
      subscriptions.findOne.mockResolvedValue(s);
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(s.canceledAt).toBe(original);
    });

    it('skips the save entirely when nothing changed', async () => {
      adapter.normalizeEvent.mockReturnValue(subEvent({
        event: 'subscription.updated',
        providerSubscriptionId: 'chk-1',
        subscriptionStatus: SubscriptionStatus.Active,
      }));
      subscriptions.findOne.mockResolvedValue(sub({ status: SubscriptionStatus.Active }));
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(subscriptions.save).not.toHaveBeenCalled();
    });

    it('still records the event when no matching subscription exists', async () => {
      adapter.normalizeEvent.mockReturnValue(subEvent());
      subscriptions.findOne.mockResolvedValue(null);
      const res = await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(res).toEqual({ duplicate: false, eventId: null, reason: 'no_app_match' });
    });

    describe('subscription payment transactions', () => {
      it.each([
        ['subscription.payment_succeeded', TransactionStatus.Succeeded],
        ['subscription.payment_failed', TransactionStatus.Failed],
      ])('records a %s billing row', async (event, expected) => {
        adapter.normalizeEvent.mockReturnValue(subEvent({ event, status: null }));
        subscriptions.findOne.mockResolvedValue(sub());
        await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
        expect(transactions.create).toHaveBeenCalledWith(expect.objectContaining({
          appId: 'app-1',
          subscriptionId: SUB_ID,
          type: TransactionType.SubscriptionPayment,
          status: expected,
          amount: 49900,
          currency: 'PHP',
        }));
      });

      // Lemon Squeezy emits four events for one first charge: order_created,
      // subscription_created, subscription_updated and subscription_payment_success.
      // Only the last records the charge — counting order_created as well (it
      // normalizes to payment.succeeded and carries the subscription in
      // custom_data) books the same payment twice.
      // LS refunds need an ORDER id; the charge event carries only a
      // subscription-invoice id. order_created is the only event with it.
      describe('capturing the LS order id', () => {
        it('backfills the charge row when it already exists', async () => {
          adapter.normalizeEvent.mockReturnValue(subEvent({
            event: 'payment.succeeded', status: TransactionStatus.Succeeded, providerTxId: '9001',
          }));
          subscriptions.findOne.mockResolvedValue(sub());
          const unlinked = tx({ providerTxId: null });
          transactions.findOne.mockResolvedValue(unlinked);
          await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
          expect(unlinked.providerTxId).toBe('9001');
          expect(transactions.save).toHaveBeenCalledWith(unlinked);
        });

        it('stashes it on the subscription when no charge row exists yet', async () => {
          adapter.normalizeEvent.mockReturnValue(subEvent({
            event: 'payment.succeeded', status: TransactionStatus.Succeeded, providerTxId: '9002',
          }));
          const s2 = sub();
          subscriptions.findOne.mockResolvedValue(s2);
          transactions.findOne.mockResolvedValue(null);
          await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
          expect(s2.metadata).toMatchObject({ pendingOrderId: '9002' });
        });

        it('uses a stashed order id when the charge event has none', async () => {
          adapter.normalizeEvent.mockReturnValue(subEvent({
            event: 'subscription.payment_succeeded', status: null, providerTxId: null,
          }));
          subscriptions.findOne.mockResolvedValue(sub({ metadata: { pendingOrderId: '9003' } }));
          await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
          expect(transactions.create.mock.calls[0][0].providerTxId).toBe('9003');
        });

        it('clears the stash once the charge row owns the id', async () => {
          adapter.normalizeEvent.mockReturnValue(subEvent({
            event: 'subscription.payment_succeeded', status: null, providerTxId: null,
          }));
          const s3 = sub({ metadata: { pendingOrderId: '9004', tier: 'pro' } });
          subscriptions.findOne.mockResolvedValue(s3);
          await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
          expect(s3.metadata).not.toHaveProperty('pendingOrderId');
          expect(s3.metadata).toMatchObject({ tier: 'pro' });
        });
      });

      it('does not record an LS order_created as a second charge', async () => {
        adapter.normalizeEvent.mockReturnValue(subEvent({
          event: 'payment.succeeded',
          status: TransactionStatus.Succeeded,
          providerTxId: '9001',
        }));
        subscriptions.findOne.mockResolvedValue(sub());
        await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
        expect(transactions.create).not.toHaveBeenCalled();
      });

      // issueOrderRefund only accepts an order id, so carry it when the event has one.
      it('stores the provider id on the transaction when the event carries one', async () => {
        adapter.normalizeEvent.mockReturnValue(subEvent({
          event: 'subscription.payment_succeeded', status: null, providerTxId: '9002',
        }));
        subscriptions.findOne.mockResolvedValue(sub());
        await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
        expect(transactions.create.mock.calls[0][0].providerTxId).toBe('9002');
      });

      it('prefers the plan price over the payload amount', async () => {
        adapter.normalizeEvent.mockReturnValue(subEvent({
          event: 'subscription.payment_succeeded',
          raw: { data: { attributes: { total: 999, currency: 'USD' } } },
        }));
        subscriptions.findOne.mockResolvedValue(sub());
        await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
        expect(transactions.create.mock.calls[0][0]).toMatchObject({ amount: 49900, currency: 'PHP' });
      });

      it('falls back to the payload amount when the plan is missing', async () => {
        adapter.normalizeEvent.mockReturnValue(subEvent({
          event: 'subscription.payment_succeeded',
          raw: { data: { attributes: { total: 999, currency: 'USD' } } },
        }));
        subscriptions.findOne.mockResolvedValue(sub({ plan: undefined }));
        await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
        expect(transactions.create.mock.calls[0][0]).toMatchObject({ amount: 999, currency: 'USD' });
      });

      it('defaults to zero PHP when neither plan nor payload has an amount', async () => {
        adapter.normalizeEvent.mockReturnValue(subEvent({ event: 'subscription.payment_succeeded' }));
        subscriptions.findOne.mockResolvedValue(sub({ plan: undefined }));
        await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
        expect(transactions.create.mock.calls[0][0]).toMatchObject({ amount: 0, currency: 'PHP' });
      });

      // AcePay is subscription-only, so this path produces every transaction the
      // product has. Without a log entry the admin activity feed and every
      // transaction timeline are permanently empty.
      it.each([
        ['subscription.payment_succeeded', LogAction.SubscriptionPaymentSucceeded],
        ['subscription.payment_failed', LogAction.SubscriptionPaymentFailed],
      ])('writes an audit entry for %s', async (event, action) => {
        adapter.normalizeEvent.mockReturnValue(subEvent({ event, status: null }));
        subscriptions.findOne.mockResolvedValue(sub());
        await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
        expect(txLogger.log).toHaveBeenCalledWith(expect.objectContaining({
          action,
          actor: LogActor.Provider,
          providerEventId: 'evt-1',
        }));
      });

      it('links the stored webhook event to the transaction it produced', async () => {
        adapter.normalizeEvent.mockReturnValue(subEvent({
          event: 'subscription.payment_succeeded', status: null,
        }));
        subscriptions.findOne.mockResolvedValue(sub());
        await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
        expect(webhooks.create).toHaveBeenCalledWith(expect.objectContaining({
          transactionId: 'tx-new',
        }));
        expect(deliveryQueue.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({ transactionId: 'tx-new' }),
        );
      });

      it('logs the Xendit cycle-1 transaction as well', async () => {
        adapter.normalizeEvent.mockReturnValue(subEvent({
          event: 'subscription.created', provider: Provider.Xendit,
          raw: { payment_method_id: 'pm-1' },
        }));
        subscriptions.findOne.mockResolvedValue(sub({ provider: Provider.Xendit }));
        customers.findOne.mockResolvedValue({ id: 'cus-1' } as Customer);
        await service.handle(Provider.Xendit, BODY, 'tok');
        expect(txLogger.log).toHaveBeenCalledWith(expect.objectContaining({
          action: LogAction.SubscriptionPaymentSucceeded,
          details: expect.objectContaining({ cycle: 1 }),
        }));
      });

      it('records no billing row for a non-payment subscription event', async () => {
        adapter.normalizeEvent.mockReturnValue(subEvent({ event: 'subscription.paused' }));
        subscriptions.findOne.mockResolvedValue(sub());
        await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
        expect(transactions.create).not.toHaveBeenCalled();
      });
    });
  });

  // Without the saved payment method there is no recurring billing at all —
  // this is the hand-off from hosted checkout to AcePay-managed charging.
  describe('Xendit first payment', () => {
    function xenditFirstPayment(raw: Record<string, unknown> = { payment_method_id: 'pm-1' }) {
      return subEvent({
        event: 'subscription.created',
        provider: Provider.Xendit,
        providerTxId: 'inv-1',
        raw,
      });
    }

    beforeEach(() => {
      adapter.normalizeEvent.mockReturnValue(xenditFirstPayment());
      subscriptions.findOne.mockResolvedValue(sub({ provider: Provider.Xendit }));
      customers.findOne.mockResolvedValue({ id: 'cus-1' } as Customer);
    });

    it('saves the payment method on the customer as active', async () => {
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(customers.save).toHaveBeenCalledWith(expect.objectContaining({
        xenditPaymentMethodId: 'pm-1',
        xenditPaymentMethodStatus: XenditPaymentMethodStatus.Active,
      }));
    });

    it('accepts payment_id as a fallback for payment_method_id', async () => {
      adapter.normalizeEvent.mockReturnValue(xenditFirstPayment({ payment_id: 'pay-9' }));
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(customers.save).toHaveBeenCalledWith(expect.objectContaining({
        xenditPaymentMethodId: 'pay-9',
      }));
    });

    // Real Xendit invoice callbacks do not carry payment_method_id. Treating
    // that as fatal meant a genuinely paid subscription got no transaction, no
    // billing period and no next cycle — found by paying a real test checkout.
    it('still records cycle 1 when the payload carries no payment method', async () => {
      adapter.normalizeEvent.mockReturnValue(xenditFirstPayment({}));
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(customers.save).not.toHaveBeenCalled();           // nothing to save
      expect(transactions.create).toHaveBeenCalledWith(expect.objectContaining({
        type: TransactionType.SubscriptionPayment,
        status: TransactionStatus.Succeeded,
        description: 'Pro — cycle 1',
      }));
      expect(billingQueue.enqueue).toHaveBeenCalled();          // period advanced
    });

    // Without this the only signal is a failed charge a month later.
    it('flags the subscription so the operator sees recurring is not armed', async () => {
      adapter.normalizeEvent.mockReturnValue(xenditFirstPayment({}));
      const s = sub({ provider: Provider.Xendit });
      subscriptions.findOne.mockResolvedValue(s);
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(s.metadata).toMatchObject({
        recurringUnavailable: true,
        recurringUnavailableReason: 'xendit_invoice_callback_carried_no_payment_method_id',
      });
    });

    it('does not flag it when a payment method was saved', async () => {
      adapter.normalizeEvent.mockReturnValue(xenditFirstPayment({ payment_method_id: 'pm-1' }));
      const s = sub({ provider: Provider.Xendit });
      subscriptions.findOne.mockResolvedValue(s);
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(s.metadata).not.toHaveProperty('recurringUnavailable');
    });

    it('saves the payment method when one IS present', async () => {
      adapter.normalizeEvent.mockReturnValue(xenditFirstPayment({ payment_method_id: 'pm-9' }));
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(customers.save).toHaveBeenCalledWith(expect.objectContaining({
        xenditPaymentMethodId: 'pm-9',
      }));
    });

    it('records cycle 1 so billing history starts at the first payment', async () => {
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(transactions.create).toHaveBeenCalledWith(expect.objectContaining({
        subscriptionId: SUB_ID,
        type: TransactionType.SubscriptionPayment,
        status: TransactionStatus.Succeeded,
        amount: 49900,
        providerTxId: 'inv-1',
        description: 'Pro — cycle 1',
      }));
    });

    it('schedules cycle 2 one interval out', async () => {
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(billingQueue.enqueue).toHaveBeenCalledWith(
        { subscriptionId: SUB_ID, cycleNumber: 2 },
        expect.any(Number),
      );
      expect(billingQueue.enqueue.mock.calls[0][1]).toBeGreaterThan(0);
    });

    it.each([
      [PlanInterval.Weekly, 1, 7],
      [PlanInterval.Weekly, 2, 14],
      [PlanInterval.Monthly, 1, 28],
      [PlanInterval.Yearly, 1, 365],
    ])('schedules a %s x%i plan at least %i days out', async (interval, intervalCount, minDays) => {
      subscriptions.findOne.mockResolvedValue(sub({
        provider: Provider.Xendit,
        plan: { amount: 49900, currency: 'PHP', name: 'Pro', interval, intervalCount } as never,
      }));
      await service.handle(Provider.Xendit, BODY, 'tok');
      const delayMs = billingQueue.enqueue.mock.calls[0][1] as number;
      expect(delayMs / 86_400_000).toBeGreaterThanOrEqual(minDays - 1);
    });

    // customerId is NOT NULL in the schema, so the `!sub.customerId` guard can
    // only be reached by a falsy string on a partially-hydrated row.
    it('does nothing for a subscription with no customer', async () => {
      subscriptions.findOne.mockResolvedValue(sub({ provider: Provider.Xendit, customerId: '' }));
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(customers.save).not.toHaveBeenCalled();
      expect(billingQueue.enqueue).not.toHaveBeenCalled();
    });

    it('still saves the payment method when the customer row is gone', async () => {
      customers.findOne.mockResolvedValue(null);
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(customers.save).not.toHaveBeenCalled();
      // Cycle 2 is still scheduled — the processor will report the missing PM.
      expect(billingQueue.enqueue).toHaveBeenCalled();
    });

    it('does not run the Xendit path for a Lemon Squeezy subscription', async () => {
      adapter.normalizeEvent.mockReturnValue(subEvent({ event: 'subscription.created' }));
      subscriptions.findOne.mockResolvedValue(sub({ provider: Provider.Lemonsqueezy }));
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(customers.save).not.toHaveBeenCalled();
      expect(billingQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  // Card-only recurring (Slice 4c): the customer links a reusable card, then
  // AcePay charges cycle 1 itself. The old invoice flow produced a one-off
  // charge and nothing reusable, so cycle 2 could never be billed.
  describe('Xendit card linked', () => {
    function linked(overrides: Record<string, unknown> = {}) {
      return subEvent({
        event: 'subscription.payment_method_linked',
        provider: Provider.Xendit,
        raw: { id: 'pm_1', customer_id: 'xcus-1', status: 'ACTIVE', ...overrides },
      });
    }

    beforeEach(() => {
      adapter.normalizeEvent.mockReturnValue(linked());
      subscriptions.findOne.mockResolvedValue(sub({ provider: Provider.Xendit }));
      customers.findOne.mockResolvedValue({ id: 'cus-1' } as Customer);
    });

    it('saves the reusable card on the customer', async () => {
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(customers.save).toHaveBeenCalledWith(expect.objectContaining({
        xenditPaymentMethodId: 'pm_1',
        xenditPaymentMethodStatus: XenditPaymentMethodStatus.Active,
      }));
    });

    it('charges cycle 1 immediately against the linked card', async () => {
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(chargeWithPaymentMethod).toHaveBeenCalledWith(expect.objectContaining({
        paymentMethodId: 'pm_1', amount: 49900, currency: 'PHP',
        referenceId: `sub_${SUB_ID}_cycle_1`,
      }));
    });

    it('records cycle 1 and schedules cycle 2', async () => {
      const s = sub({ provider: Provider.Xendit });
      subscriptions.findOne.mockResolvedValue(s);
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(transactions.create).toHaveBeenCalledWith(expect.objectContaining({
        type: TransactionType.SubscriptionPayment,
        status: TransactionStatus.Succeeded,
        providerTxId: 'pr-1',
        description: 'Pro — cycle 1',
      }));
      expect(s.currentPeriodEnd).toBeInstanceOf(Date);
      expect(billingQueue.enqueue).toHaveBeenCalledWith(
        { subscriptionId: SUB_ID, cycleNumber: 2 }, expect.any(Number),
      );
    });

    it('clears the awaiting-payment flags once armed', async () => {
      const s = sub({
        provider: Provider.Xendit,
        metadata: { awaitingFirstPayment: true, checkoutUrl: 'https://pm/x', tier: 'pro' },
      });
      subscriptions.findOne.mockResolvedValue(s);
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(s.metadata).toEqual({ tier: 'pro' });
    });

    it('marks the sub past_due and schedules nothing when cycle 1 is declined', async () => {
      chargeWithPaymentMethod.mockResolvedValue({ paymentRequestId: 'pr-2', status: 'FAILED' });
      const s = sub({ provider: Provider.Xendit });
      subscriptions.findOne.mockResolvedValue(s);
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(s.status).toBe(SubscriptionStatus.PastDue);
      expect(billingQueue.enqueue).not.toHaveBeenCalled();
      expect(transactions.create).toHaveBeenCalledWith(expect.objectContaining({
        status: TransactionStatus.Failed,
      }));
    });

    it('survives the charge call throwing, leaving the sub visibly past_due', async () => {
      chargeWithPaymentMethod.mockRejectedValue(new Error('network blip'));
      const s = sub({ provider: Provider.Xendit });
      subscriptions.findOne.mockResolvedValue(s);
      await expect(service.handle(Provider.Xendit, BODY, 'tok')).resolves.toBeDefined();
      expect(s.status).toBe(SubscriptionStatus.PastDue);
      expect(billingQueue.enqueue).not.toHaveBeenCalled();
    });

    it('audits the cycle-1 transaction', async () => {
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(txLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: LogAction.SubscriptionPaymentSucceeded,
        details: expect.objectContaining({ cycle: 1 }),
      }));
    });
  });

  describe('Xendit card link failed', () => {
    it('marks the subscription past_due and says why', async () => {
      adapter.normalizeEvent.mockReturnValue(subEvent({
        event: 'subscription.payment_method_failed',
        provider: Provider.Xendit,
        raw: { id: 'pm_1', status: 'FAILED' },
      }));
      const s = sub({ provider: Provider.Xendit, metadata: { awaitingFirstPayment: true } });
      subscriptions.findOne.mockResolvedValue(s);
      await service.handle(Provider.Xendit, BODY, 'tok');
      expect(s.status).toBe(SubscriptionStatus.PastDue);
      expect(s.metadata).toMatchObject({
        recurringUnavailable: true, recurringUnavailableReason: 'card_link_failed',
      });
      expect(chargeWithPaymentMethod).not.toHaveBeenCalled();
    });
  });

  describe('persistence and outbound delivery', () => {
    it('stores the event with retry state ready for the worker', async () => {
      transactions.findOne.mockResolvedValue(tx());
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(webhooks.create).toHaveBeenCalledWith(expect.objectContaining({
        appId: 'app-1',
        transactionId: TX_ID,
        provider: Provider.Lemonsqueezy,
        eventType: 'payment.succeeded',
        providerEventId: 'evt-1',
        deliveryStatus: WebhookDeliveryStatus.Pending,
        attempts: 0,
        maxAttempts: 5,
      }));
    });

    it('hands the saved event id to the delivery queue', async () => {
      transactions.findOne.mockResolvedValue(tx());
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(deliveryQueue.enqueue).toHaveBeenCalledWith({
        webhookEventId: 'evt-row-1', transactionId: TX_ID,
      });
    });

    it('builds an app-facing payload from the transaction', async () => {
      transactions.findOne.mockResolvedValue(tx({ amount: 49900, currency: 'PHP' }));
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(webhooks.create.mock.calls[0][0].normalizedPayload).toMatchObject({
        event: 'payment.succeeded',
        transaction_id: TX_ID,
        provider: Provider.Lemonsqueezy,
        amount: 49900,
        currency: 'PHP',
      });
    });

    it('adds the fee breakdown for a marketplace payment', async () => {
      transactions.findOne.mockResolvedValue(tx({
        merchantId: 'm-1', platformFeePercent: 12, platformFeeAmount: 6000, merchantAmount: 44000,
      } as Partial<Transaction>));
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(webhooks.create.mock.calls[0][0].normalizedPayload.marketplace).toEqual({
        merchant_id: 'm-1', fee_percent: 12, platform_fee: 6000, merchant_amount: 44000,
      });
    });

    it('has no marketplace block for an ordinary payment', async () => {
      transactions.findOne.mockResolvedValue(tx());
      await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(webhooks.create.mock.calls[0][0].normalizedPayload).not.toHaveProperty('marketplace');
    });

    // An event we cannot attribute to an app has nowhere to go — recording it
    // against a guessed app would leak one tenant's data to another.
    it('drops an event that cannot be attributed to an app', async () => {
      transactions.findOne.mockResolvedValue(null);
      const res = await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(res).toEqual({ duplicate: false, eventId: null, reason: 'no_app_match' });
      expect(webhooks.save).not.toHaveBeenCalled();
      expect(deliveryQueue.enqueue).not.toHaveBeenCalled();
    });

    it('records the event but skips delivery when the app row is missing', async () => {
      transactions.findOne.mockResolvedValue(tx());
      apps.findOne.mockResolvedValue(null);
      const res = await service.handle(Provider.Lemonsqueezy, BODY, 'sig');
      expect(webhooks.save).toHaveBeenCalled();
      expect(deliveryQueue.enqueue).not.toHaveBeenCalled();
      expect(res).toMatchObject({ duplicate: false, eventId: 'evt-row-1' });
    });
  });
});
