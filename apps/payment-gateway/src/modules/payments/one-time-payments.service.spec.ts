jest.mock('../../database/entities', () => ({
  App: class App {}, Customer: class Customer {}, Plan: class Plan {}, Subscription: class Subscription {},
  Transaction: class Transaction {}, TransactionLog: class TransactionLog {}, User: class User {},
  WebhookEvent: class WebhookEvent {}, Merchant: class Merchant {}, Payout: class Payout {},
  PayoutRun: class PayoutRun {}, XenditSplitRule: class XenditSplitRule {}, PlatformSetting: class PlatformSetting {},
}));

import { Repository } from 'typeorm';
import { LogAction, Provider, TransactionStatus, TransactionType } from '../../common/enums';
import { TransactionLoggerService } from '../../common/services/transaction-logger.service';
import { App, Transaction } from '../../database/entities';
import { ProviderRegistry } from '../../payment-providers/provider.registry';
import { AppStatusService } from '../apps/app-status.service';
import { CreateMarketplacePaymentDto } from '../marketplace/dto/marketplace-payment.dto';
import { OneTimePaymentsService } from './one-time-payments.service';

const APP = { id: 'app-pm', slug: 'uat-paymongo', name: 'UAT PayMongo', marketplaceEnabled: false } as App;

function dto(o: Partial<CreateMarketplacePaymentDto> = {}): CreateMarketplacePaymentDto {
  return {
    amount: 9900,
    currency: 'php',
    idempotencyKey: 'order-1',
    description: 'Order #1',
    redirect: { success: 'https://shop.ph/ok', failed: 'https://shop.ph/no' },
    customer: { email: 'buyer@x.com' },
    metadata: { orderId: 'order-1' },
    ...o,
  } as CreateMarketplacePaymentDto;
}

describe('OneTimePaymentsService (POST /v1/payments without a merchant)', () => {
  let transactions: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let adapter: { createPayment: jest.Mock };
  let providers: { resolve: jest.Mock };
  let appStatus: { providersFor: jest.Mock };
  let txLogger: { log: jest.Mock };
  let service: OneTimePaymentsService;

  beforeEach(() => {
    transactions = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((t) => ({ ...t })),
      save: jest.fn((t) => {
        Object.assign(t, { id: t.id ?? 'tx-1', code: t.code ?? 'TXN-000001', createdAt: t.createdAt ?? new Date('2026-10-12T00:00:00Z') });
        return Promise.resolve(t);
      }),
    };
    adapter = {
      createPayment: jest.fn().mockResolvedValue({
        providerTxId: 'cs_123', checkoutUrl: 'https://checkout.paymongo.com/cs_123',
        providerCreatedAt: new Date('2026-10-12T00:00:01Z'), raw: {},
      }),
    };
    providers = { resolve: jest.fn().mockReturnValue(adapter) };
    appStatus = { providersFor: jest.fn().mockResolvedValue(new Map([['app-pm', [Provider.Paymongo]]])) };
    txLogger = { log: jest.fn().mockResolvedValue(undefined) };
    service = new OneTimePaymentsService(
      transactions as unknown as Repository<Transaction>,
      providers as unknown as ProviderRegistry,
      appStatus as unknown as AppStatusService,
      txLogger as unknown as TransactionLoggerService,
    );
  });

  it('creates a pending PayMongo payment and returns the checkout URL', async () => {
    const view = await service.create(APP, dto());
    expect(transactions.create).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'app-pm', provider: Provider.Paymongo, type: TransactionType.Payment,
      status: TransactionStatus.Pending, amount: 9900, currency: 'PHP', idempotencyKey: 'order-1',
    }));
    expect(providers.resolve).toHaveBeenCalledWith(Provider.Paymongo);
    // Minor units go straight through (PayMongo takes centavos).
    expect(adapter.createPayment).toHaveBeenCalledWith(expect.objectContaining({
      acepayTxId: 'tx-1', appSlug: 'uat-paymongo', amount: 9900, currency: 'PHP',
      redirect: { success: 'https://shop.ph/ok', failed: 'https://shop.ph/no' },
      customer: { email: 'buyer@x.com' },
    }));
    expect(view).toEqual(expect.objectContaining({
      id: 'tx-1', status: TransactionStatus.Pending, provider: Provider.Paymongo,
      checkoutUrl: 'https://checkout.paymongo.com/cs_123',
    }));
    expect(txLogger.log.mock.calls.map((c) => c[0].action)).toEqual([LogAction.PaymentCreated, LogAction.PaymentProviderSent]);
  });

  it('stores the checkout session id so the paid webhook can find and swap it', async () => {
    await service.create(APP, dto());
    const last = transactions.save.mock.calls.at(-1)![0];
    expect(last.providerTxId).toBe('cs_123');
  });

  it('returns the existing payment for the same idempotency key without calling PayMongo', async () => {
    transactions.findOne.mockResolvedValue({
      id: 'tx-old', code: 'TXN-000009', appId: 'app-pm', amount: 9900, provider: Provider.Paymongo,
      status: TransactionStatus.Pending, providerTxId: 'cs_old', checkoutUrl: 'https://checkout/old', merchantId: null,
    });
    const view = await service.create(APP, dto());
    expect(view.id).toBe('tx-old');
    expect(adapter.createPayment).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key reused for a different amount', async () => {
    transactions.findOne.mockResolvedValue({ id: 'tx-old', amount: 5000, merchantId: null });
    await expect(service.create(APP, dto())).rejects.toMatchObject({ response: { error: 'idempotency_key_reused' } });
  });

  it('retries a payment that failed before PayMongo made a checkout', async () => {
    const failed = {
      id: 'tx-old', code: 'TXN-000009', appId: 'app-pm', amount: 9900, provider: Provider.Paymongo,
      currency: 'PHP', status: TransactionStatus.Failed, providerTxId: null, merchantId: null,
    };
    transactions.findOne.mockResolvedValue(failed);
    const view = await service.create(APP, dto());
    expect(adapter.createPayment).toHaveBeenCalledWith(expect.objectContaining({ acepayTxId: 'tx-old' }));
    expect(view.checkoutUrl).toBe('https://checkout.paymongo.com/cs_123');
    expect(transactions.create).not.toHaveBeenCalled();
  });

  it('marks the row failed and rethrows when PayMongo refuses', async () => {
    adapter.createPayment.mockRejectedValue(new Error('PayMongo POST /checkout_sessions failed: bad amount'));
    await expect(service.create(APP, dto())).rejects.toThrow('bad amount');
    const last = transactions.save.mock.calls.at(-1)![0];
    expect(last.status).toBe(TransactionStatus.Failed);
    expect(txLogger.log.mock.calls.at(-1)![0].action).toBe(LogAction.PaymentFailed);
  });

  it.each([
    ['a Lemon Squeezy app', [Provider.Lemonsqueezy], /Lemonsqueezy|lemonsqueezy/],
    ['an app with no provider', [], /no provider/],
  ])('refuses %s before creating anything', async (_label, provs, message) => {
    appStatus.providersFor.mockResolvedValue(new Map([['app-pm', provs]]));
    await expect(service.create(APP, dto())).rejects.toMatchObject({
      response: { error: 'one_time_not_supported', message: expect.stringMatching(message) },
    });
    expect(transactions.create).not.toHaveBeenCalled();
  });
});
