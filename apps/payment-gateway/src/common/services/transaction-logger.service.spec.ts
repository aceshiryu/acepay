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

import { Repository } from 'typeorm';
import { LogAction, LogActor, TransactionStatus } from '../enums';
import { Transaction, TransactionLog } from '../../database/entities';
import { TransactionLoggerService } from './transaction-logger.service';

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return { id: 'tx-1', appId: 'app-1', status: TransactionStatus.Pending, ...overrides } as Transaction;
}

describe('TransactionLoggerService', () => {
  let logs: { create: jest.Mock; save: jest.Mock };
  let service: TransactionLoggerService;

  beforeEach(() => {
    logs = {
      create: jest.fn((row) => row),
      save: jest.fn((row) => Promise.resolve({ id: 'log-1', ...row })),
    };
    service = new TransactionLoggerService(logs as unknown as Repository<TransactionLog>);
  });

  /** The row handed to save(). */
  async function written(input: Parameters<TransactionLoggerService['log']>[0]) {
    await service.log(input);
    return logs.save.mock.calls[0][0];
  }

  it('denormalizes the transaction and app ids onto the log row', async () => {
    const row = await written({ transaction: tx(), action: LogAction.PaymentCreated });
    expect(row).toMatchObject({ transactionId: 'tx-1', appId: 'app-1', action: LogAction.PaymentCreated });
  });

  it('returns the persisted row', async () => {
    const saved = await service.log({ transaction: tx(), action: LogAction.PaymentCreated });
    expect(saved).toMatchObject({ id: 'log-1' });
  });

  it('records the status transition when given one', async () => {
    const row = await written({
      transaction: tx(),
      action: LogAction.PaymentSucceeded,
      statusFrom: TransactionStatus.Pending,
      statusTo: TransactionStatus.Succeeded,
    });
    expect(row.statusFrom).toBe(TransactionStatus.Pending);
    expect(row.statusTo).toBe(TransactionStatus.Succeeded);
  });

  // These columns are nullable, so every optional field must become an explicit
  // null rather than undefined — TypeORM skips undefined on insert, which would
  // silently fall back to a column default instead of writing null.
  it('normalizes every omitted optional field to null (never undefined)', async () => {
    const row = await written({ transaction: tx(), action: LogAction.PaymentCreated });
    expect(row.statusFrom).toBeNull();
    expect(row.statusTo).toBeNull();
    expect(row.providerEventId).toBeNull();
    expect(row.ipAddress).toBeNull();
    for (const [key, value] of Object.entries(row)) {
      expect(value).not.toBeUndefined();
      expect(typeof key).toBe('string');
    }
  });

  it.each([
    ['statusFrom', 'statusFrom'],
    ['statusTo', 'statusTo'],
    ['providerEventId', 'providerEventId'],
    ['ipAddress', 'ipAddress'],
  ])('turns an explicit undefined %s into null', async (_label, field) => {
    const row = await written({
      transaction: tx(),
      action: LogAction.PaymentCreated,
      [field]: undefined,
    });
    expect(row[field]).toBeNull();
  });

  it('defaults the actor to the system', async () => {
    const row = await written({ transaction: tx(), action: LogAction.PaymentCreated });
    expect(row.actor).toBe(LogActor.System);
  });

  it.each([LogActor.Admin, LogActor.App, LogActor.Provider, LogActor.System])(
    'records an explicit %s actor',
    async (actor) => {
      const row = await written({ transaction: tx(), action: LogAction.PaymentCreated, actor });
      expect(row.actor).toBe(actor);
    },
  );

  it('defaults details to an empty object so the jsonb column is never null', async () => {
    const row = await written({ transaction: tx(), action: LogAction.PaymentCreated });
    expect(row.details).toEqual({});
  });

  it('keeps the details payload as given', async () => {
    const details = { url: 'https://savi.app/hook', attempts: 3, nested: { a: [1, 2] } };
    const row = await written({ transaction: tx(), action: LogAction.PaymentAppNotified, details });
    expect(row.details).toBe(details);
  });

  it('preserves a deliberately empty-string ipAddress rather than nulling it', async () => {
    // `?? null` only replaces null/undefined, so '' survives — worth pinning so
    // a future switch to `||` doesn't quietly change what gets stored.
    const row = await written({ transaction: tx(), action: LogAction.PaymentCreated, ipAddress: '' });
    expect(row.ipAddress).toBe('');
  });

  // Unlike the optional fields above, appId is copied verbatim with no `?? null`
  // — it is NOT NULL in the schema, so a falsy value here is a caller bug that
  // should surface as a constraint violation rather than be quietly rewritten.
  it('copies the app id verbatim without normalizing it', async () => {
    const row = await written({ transaction: tx({ appId: '' }), action: LogAction.PaymentCreated });
    expect(row.appId).toBe('');
  });

  it('propagates a write failure instead of swallowing the audit entry', async () => {
    logs.save.mockRejectedValue(new Error('deadlock detected'));
    await expect(service.log({ transaction: tx(), action: LogAction.PaymentCreated }))
      .rejects.toThrow('deadlock detected');
  });
});
