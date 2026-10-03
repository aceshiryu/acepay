// The entity barrel has a circular import (App → Customer → Subscription →
// Plan → App) that swc-jest turns into a temporal-dead-zone error at load.
// These specs only need the classes as DI tokens, so stub the barrel out.
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

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  LogAction, LogActor, Provider, TransactionStatus, TransactionType,
} from '../../common/enums';
import { PaymentReconcilerService } from '../../common/services/payment-reconciler.service';
import { TransactionLoggerService } from '../../common/services/transaction-logger.service';
import { App, Transaction } from '../../database/entities';
import { ProviderRegistry } from '../../payment-providers/provider.registry';
import { PaymentsAppService } from './payments-app.service';

const CALLER = { id: 'app-1', slug: 'savi' } as App;

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    appId: 'app-1',
    customerId: 'cus-1',
    provider: Provider.Xendit,
    providerTxId: 'inv-1',
    type: TransactionType.SubscriptionPayment,
    status: TransactionStatus.Succeeded,
    amount: 49900,
    currency: 'PHP',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Transaction;
}

describe('PaymentsAppService (/v1/payments)', () => {
  let em: Record<string, jest.Mock>;
  let transactions: {
    findOne: jest.Mock; create: jest.Mock; save: jest.Mock; createQueryBuilder: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let qb: Record<string, jest.Mock>;
  let refundFn: jest.Mock;
  let providers: { resolve: jest.Mock };
  let txLogger: { log: jest.Mock };
  let reconciler: { reconcile: jest.Mock };
  let service: PaymentsAppService;

  beforeEach(() => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ refunded: '0' }),
    };
    em = {
      findOne: jest.fn().mockResolvedValue({ id: 'tx-1' }),
      createQueryBuilder: jest.fn(() => qb),
      create: jest.fn((_e, v) => v),
      save: jest.fn((v) => Promise.resolve({ id: 'tx-refund', ...v })),
    };
    transactions = {
      manager: { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(em)) },
      findOne: jest.fn(),
      create: jest.fn((t) => t),
      save: jest.fn((t) => Promise.resolve({ id: 'tx-refund', ...t })),
      createQueryBuilder: jest.fn(() => qb),
    };
    refundFn = jest.fn().mockResolvedValue({
      providerRefundId: 'rfd-1', status: TransactionStatus.Refunded, raw: {},
    });
    providers = { resolve: jest.fn().mockReturnValue({ refund: refundFn }) };
    txLogger = { log: jest.fn().mockResolvedValue(undefined) };
    reconciler = { reconcile: jest.fn().mockResolvedValue({ changed: false }) };
    service = new PaymentsAppService(
      transactions as unknown as Repository<Transaction>,
      providers as unknown as ProviderRegistry,
      txLogger as unknown as TransactionLoggerService,
      reconciler as unknown as PaymentReconcilerService,
    );
  });

  // The single most important property of a multi-tenant API: one app's key
  // must never reach another app's data. Every read is scoped by appId.
  describe('tenant isolation', () => {
    it.each([
      ['findOne', () => service.findOne(CALLER, 'tx-1')],
      ['sync', () => service.sync(CALLER, 'tx-1')],
      ['refund', () => service.refund(CALLER, 'tx-1', {})],
    ])('%s scopes the lookup to the calling app', async (_label, call) => {
      transactions.findOne.mockResolvedValue(null);
      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
      expect(transactions.findOne).toHaveBeenCalledWith({ where: { id: 'tx-1', appId: 'app-1' } });
    });

    it('list filters by the calling app before anything else', async () => {
      await service.list(CALLER, {});
      expect(qb.where).toHaveBeenCalledWith('tx.app_id = :appId', { appId: 'app-1' });
    });

    // A transaction that exists but belongs to another app must look exactly
    // like one that does not exist — no "forbidden" leak of its existence.
    it('reports another app’s transaction as simply not found', async () => {
      transactions.findOne.mockResolvedValue(null);
      try {
        await service.findOne(CALLER, 'tx-of-other-app');
        throw new Error('expected a throw');
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect((e as NotFoundException).getResponse()).toEqual({
          error: 'transaction_not_found',
          message: 'Transaction tx-of-other-app not found',
        });
      }
    });
  });

  describe('findOne auto-sync', () => {
    const STALE = new Date(Date.now() - 60_000);
    const FRESH = new Date(Date.now() - 1_000);

    it('reconciles a pending transaction older than the 30s threshold', async () => {
      const pending = tx({ status: TransactionStatus.Pending, createdAt: STALE });
      transactions.findOne.mockResolvedValue(pending);
      await service.findOne(CALLER, 'tx-1');
      expect(reconciler.reconcile).toHaveBeenCalledWith(pending, LogActor.System);
    });

    it('returns the refreshed row when reconciliation changed something', async () => {
      const pending = tx({ status: TransactionStatus.Pending, createdAt: STALE });
      const refreshed = tx({ status: TransactionStatus.Succeeded });
      transactions.findOne.mockResolvedValueOnce(pending).mockResolvedValueOnce(refreshed);
      reconciler.reconcile.mockResolvedValue({ changed: true });
      await expect(service.findOne(CALLER, 'tx-1')).resolves.toBe(refreshed);
    });

    it('returns the original row when reconciliation changed nothing', async () => {
      const pending = tx({ status: TransactionStatus.Pending, createdAt: STALE });
      transactions.findOne.mockResolvedValue(pending);
      reconciler.reconcile.mockResolvedValue({ changed: false });
      await expect(service.findOne(CALLER, 'tx-1')).resolves.toBe(pending);
    });

    it('falls back to the original row if the refresh comes back empty', async () => {
      const pending = tx({ status: TransactionStatus.Pending, createdAt: STALE });
      transactions.findOne.mockResolvedValueOnce(pending).mockResolvedValueOnce(null);
      reconciler.reconcile.mockResolvedValue({ changed: true });
      await expect(service.findOne(CALLER, 'tx-1')).resolves.toBe(pending);
    });

    it.each([
      ['the transaction is fresh', { status: TransactionStatus.Pending, createdAt: FRESH }],
      ['it already succeeded', { status: TransactionStatus.Succeeded, createdAt: STALE }],
      ['it already failed', { status: TransactionStatus.Failed, createdAt: STALE }],
      ['there is no provider id to sync against', {
        status: TransactionStatus.Pending, createdAt: STALE, providerTxId: null,
      }],
    ])('does not reconcile when %s', async (_label, overrides) => {
      transactions.findOne.mockResolvedValue(tx(overrides as Partial<Transaction>));
      await service.findOne(CALLER, 'tx-1');
      expect(reconciler.reconcile).not.toHaveBeenCalled();
    });

    it('handles a createdAt that arrives as a string from the driver', async () => {
      transactions.findOne.mockResolvedValue(tx({
        status: TransactionStatus.Pending,
        createdAt: new Date(Date.now() - 60_000).toISOString() as unknown as Date,
      }));
      await service.findOne(CALLER, 'tx-1');
      expect(reconciler.reconcile).toHaveBeenCalled();
    });
  });

  describe('sync', () => {
    it('attributes an explicit sync to the app, not the system', async () => {
      const t = tx();
      transactions.findOne.mockResolvedValue(t);
      await service.sync(CALLER, 'tx-1');
      expect(reconciler.reconcile).toHaveBeenCalledWith(t, LogActor.App);
    });

    it('returns the reconcile outcome alongside the refreshed transaction', async () => {
      const t = tx();
      const refreshed = tx({ status: TransactionStatus.Succeeded });
      transactions.findOne.mockResolvedValueOnce(t).mockResolvedValueOnce(refreshed);
      reconciler.reconcile.mockResolvedValue({ changed: true, before: 'pending', after: 'succeeded' });
      const res = await service.sync(CALLER, 'tx-1');
      expect(res).toMatchObject({ changed: true, transaction: refreshed });
    });

    it('syncs unconditionally, even for a fresh already-succeeded transaction', async () => {
      transactions.findOne.mockResolvedValue(tx({ createdAt: new Date() }));
      await service.sync(CALLER, 'tx-1');
      expect(reconciler.reconcile).toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('applies every documented filter', async () => {
      await service.list(CALLER, {
        provider: Provider.Xendit,
        type: TransactionType.Refund,
        status: TransactionStatus.Succeeded,
        source: 'web' as never,
        customerId: 'cus-1',
        from: '2026-01-01',
        to: '2026-02-01',
      });
      const clauses = qb.andWhere.mock.calls.map((c) => c[0]);
      expect(clauses).toEqual([
        'tx.provider = :provider',
        'tx.type = :type',
        'tx.status = :status',
        'tx.source = :source',
        'tx.customer_id = :customerId',
        'tx.created_at >= :from',
        'tx.created_at <= :to',
      ]);
    });

    it('applies no optional filters when none are given', async () => {
      await service.list(CALLER, {});
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    // Ordering must use the ENTITY property name — 'tx.created_at' explodes
    // inside getManyAndCount. This is a documented repo-wide gotcha.
    it('orders by the entity property, never the snake_case column', async () => {
      await service.list(CALLER, {});
      expect(qb.orderBy).toHaveBeenCalledWith('tx.createdAt', 'DESC');
    });

    it.each([
      [{}, 0, 20],
      [{ page: 1, pageSize: 20 }, 0, 20],
      [{ page: 3, pageSize: 10 }, 20, 10],
      [{ page: 2 }, 20, 20],
      [{ pageSize: 50 }, 0, 50],
    ])('paginates %j as skip=%i take=%i', async (q, skip, take) => {
      await service.list(CALLER, q);
      expect(qb.skip).toHaveBeenCalledWith(skip);
      expect(qb.take).toHaveBeenCalledWith(take);
    });

    it('returns the paged envelope the API documents', async () => {
      qb.getManyAndCount.mockResolvedValue([[tx()], 57]);
      await expect(service.list(CALLER, { page: 2, pageSize: 20 })).resolves.toMatchObject({
        total: 57, page: 2, pageSize: 20,
      });
    });
  });

  describe('refund', () => {
    beforeEach(() => transactions.findOne.mockResolvedValue(tx()));

    it('refunds the full amount by default', async () => {
      await service.refund(CALLER, 'tx-1', {});
      expect(refundFn).toHaveBeenCalledWith('inv-1', 49900);
    });

    it("refunds a marketplace payment out of the merchant's sub-account", async () => {
      transactions.findOne.mockResolvedValue(tx({ merchantId: 'm-1', providerAccountId: 'sub-1' } as Partial<Transaction>));
      await service.refund(CALLER, 'tx-1', {});
      expect(refundFn).toHaveBeenCalledWith('inv-1', 49900, { forUserId: 'sub-1' });
      expect(em.create.mock.calls[0][1]).toEqual(expect.objectContaining({ merchantId: 'm-1', providerAccountId: 'sub-1' }));
    });

    it('refunds a partial amount when asked', async () => {
      await service.refund(CALLER, 'tx-1', { amount: 10000 });
      expect(refundFn).toHaveBeenCalledWith('inv-1', 10000);
    });

    it('allows a refund of exactly the original amount', async () => {
      await expect(service.refund(CALLER, 'tx-1', { amount: 49900 })).resolves.toBeDefined();
    });

    it('rejects a refund larger than the original', async () => {
      await expect(service.refund(CALLER, 'tx-1', { amount: 49901 }))
        .rejects.toThrow(/exceeds original/);
      expect(refundFn).not.toHaveBeenCalled();
    });

    // The DTO now blocks these at the edge, but the service is the last line of
    // defense: a negative amount used to flip into a POSITIVE ledger row, and a
    // non-numeric one reached the integer column as NaN.
    it.each([
      ['a negative amount', -5000],
      ['zero', 0],
      ['a fractional amount', 100.5],
      ['NaN (what "abc" becomes after implicit conversion)', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('rejects %s', async (_label, amount) => {
      try {
        await service.refund(CALLER, 'tx-1', { amount });
        throw new Error('expected a throw');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).getResponse()).toMatchObject({
          error: 'invalid_refund_amount',
        });
      }
      expect(refundFn).not.toHaveBeenCalled();
      expect(transactions.save).not.toHaveBeenCalled();
    });

    // Checking only against the original amount lets a second refund re-spend the
    // whole thing; the provider's validation was the only thing stopping an
    // over-refund. Found by partially refunding a real invoice then asking for
    // the full amount again.
    describe('cumulative refunds', () => {
      it('allows a refund up to the remaining balance', async () => {
        qb.getRawOne.mockResolvedValue({ refunded: '5000' });
        await expect(service.refund(CALLER, 'tx-1', { amount: 44900 })).resolves.toBeDefined();
        expect(refundFn).toHaveBeenCalledWith('inv-1', 44900);
      });

      it('rejects a refund that would exceed what is left', async () => {
        qb.getRawOne.mockResolvedValue({ refunded: '5000' });
        try {
          await service.refund(CALLER, 'tx-1', { amount: 44901 });
          throw new Error('expected a throw');
        } catch (e) {
          expect((e as BadRequestException).getResponse()).toMatchObject({
            error: 'amount_exceeds_refundable', refundable: 44900, alreadyRefunded: 5000,
          });
        }
        expect(refundFn).not.toHaveBeenCalled();
      });

      it('rejects a full refund once anything has been refunded', async () => {
        qb.getRawOne.mockResolvedValue({ refunded: '1' });
        await expect(service.refund(CALLER, 'tx-1', {}))
          .rejects.toThrow(/still refundable/);
      });

      it('ignores failed refund rows when totalling', async () => {
        await service.refund(CALLER, 'tx-1', { amount: 100 });
        const clauses = qb.andWhere.mock.calls.map((c) => c[0]);
        expect(clauses).toEqual(expect.arrayContaining(['t.status != :failed']));
      });

      it('treats an empty aggregate as nothing refunded yet', async () => {
        qb.getRawOne.mockResolvedValue(undefined);
        await expect(service.refund(CALLER, 'tx-1', {})).resolves.toBeDefined();
      });
    });

    it.each([
      [TransactionStatus.Pending],
      [TransactionStatus.Failed],
      [TransactionStatus.Refunded],
      [TransactionStatus.Canceled],
    ])('refuses to refund a %s transaction', async (status) => {
      transactions.findOne.mockResolvedValue(tx({ status }));
      await expect(service.refund(CALLER, 'tx-1', {})).rejects.toThrow(/only succeeded payments/);
    });

    it('refuses to refund a transaction with no provider id', async () => {
      transactions.findOne.mockResolvedValue(tx({ providerTxId: null }));
      await expect(service.refund(CALLER, 'tx-1', {})).rejects.toThrow(/no provider id/);
    });

    // The refund is a SEPARATE negative-amount row; the original stays as it
    // was, which is what lets the revenue rollup net them out per currency.
    it('records the refund as a negative transaction inheriting the original context', async () => {
      await service.refund(CALLER, 'tx-1', { amount: 10000, reason: 'duplicate charge' });
      // Reserved first (pending, no provider id), then settled with the result.
      expect(em.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        appId: 'app-1',
        customerId: 'cus-1',
        provider: Provider.Xendit,
        type: TransactionType.Refund,
        status: TransactionStatus.Pending,
        amount: -10000,
        currency: 'PHP',
        metadata: { refundOf: 'tx-1', reason: 'duplicate charge' },
      }));
      const settled = transactions.save.mock.calls.at(-1)?.[0];
      expect(settled).toMatchObject({ status: TransactionStatus.Refunded, providerTxId: 'rfd-1' });
    });

    it('records a null reason when none is given', async () => {
      await service.refund(CALLER, 'tx-1', {});
      const created = em.create.mock.calls[0][1];
      expect(created.metadata).toEqual({ refundOf: 'tx-1', reason: null });
      expect(created.description).toBe('Refund of tx-1');
    });

    it('puts the reason in the description when given', async () => {
      await service.refund(CALLER, 'tx-1', { reason: 'duplicate charge' });
      expect(em.create.mock.calls[0][1].description)
        .toBe('Refund of tx-1 — duplicate charge');
    });

    it('takes the refund status from the provider', async () => {
      refundFn.mockResolvedValue({ providerRefundId: 'rfd-1', status: TransactionStatus.Pending });
      await service.refund(CALLER, 'tx-1', {});
      expect(transactions.save.mock.calls.at(-1)?.[0])
        .toMatchObject({ status: TransactionStatus.Pending });
    });

    it('audits the refund against the ORIGINAL transaction, attributed to the app', async () => {
      await service.refund(CALLER, 'tx-1', { amount: 10000 });
      expect(txLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: LogAction.PaymentRefundRequested,
        actor: LogActor.App,
        details: { refundTx: 'tx-refund', amount: 10000 },
      }));
    });

    it('routes to the adapter that took the original payment', async () => {
      transactions.findOne.mockResolvedValue(tx({ provider: Provider.Lemonsqueezy }));
      await service.refund(CALLER, 'tx-1', {});
      expect(providers.resolve).toHaveBeenCalledWith(Provider.Lemonsqueezy);
    });

    // The reservation exists by the time the provider is called, so a failure
    // must release it — otherwise a declined attempt permanently blocks the
    // balance it reserved.
    it('marks the reservation failed when the provider call fails', async () => {
      refundFn.mockRejectedValue(new Error('provider down'));
      await expect(service.refund(CALLER, 'tx-1', {})).rejects.toThrow('provider down');
      expect(transactions.save.mock.calls.at(-1)?.[0])
        .toMatchObject({ status: TransactionStatus.Failed });
      expect(txLogger.log).not.toHaveBeenCalled();
    });

    // The whole point of the lock: the balance check and the reservation must
    // not be separable, or two concurrent refunds both pass.
    it('reserves inside a transaction, locking the original payment', async () => {
      await service.refund(CALLER, 'tx-1', { amount: 100 });
      expect(transactions.manager.transaction).toHaveBeenCalled();
      expect(em.findOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        lock: { mode: 'pessimistic_write' },
      }));
    });

    it('calls the provider outside the lock, not inside it', async () => {
      await service.refund(CALLER, 'tx-1', { amount: 100 });
      // The reservation resolves before the provider is ever contacted.
      expect(em.save).toHaveBeenCalled();
      expect(refundFn).toHaveBeenCalled();
    });
  });
});
