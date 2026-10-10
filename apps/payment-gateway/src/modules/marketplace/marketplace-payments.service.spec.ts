jest.mock('../../database/entities', () => ({
  App: class App {}, Customer: class Customer {}, Plan: class Plan {}, Subscription: class Subscription {},
  Transaction: class Transaction {}, TransactionLog: class TransactionLog {}, User: class User {},
  WebhookEvent: class WebhookEvent {}, Merchant: class Merchant {}, Payout: class Payout {},
  PayoutRun: class PayoutRun {}, XenditSplitRule: class XenditSplitRule {}, PlatformSetting: class PlatformSetting {},
}));

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { LogAction, MerchantStatus, Provider, TransactionStatus, TransactionType } from '../../common/enums';
import { TransactionLoggerService } from '../../common/services/transaction-logger.service';
import { App, Merchant, Transaction } from '../../database/entities';
import { XenditPlatformClient } from '../../payment-providers/xendit-platform.client';
import { CreateMarketplacePaymentDto } from './dto/marketplace-payment.dto';
import { MarketplacePaymentsService } from './marketplace-payments.service';
import { MerchantsService } from './merchants.service';
import { SplitRulesService } from './split-rules.service';

const BOOKLY = { id: 'app-bookly', slug: 'booklyph', marketplaceEnabled: true, marketplaceFeePercent: 12 } as App;

function merchant(o: Partial<Merchant> = {}): Merchant {
  return {
    id: 'm-1', appId: BOOKLY.id, name: 'Coach Juan', status: MerchantStatus.Active,
    xenditAccountId: 'sub-1', feeOverridePercent: null, feeOverrideEndsAt: null, ...o,
  } as Merchant;
}

function dto(o: Partial<CreateMarketplacePaymentDto> = {}): CreateMarketplacePaymentDto {
  return {
    amount: 50000,
    currency: 'PHP',
    merchantId: 'm-1',
    idempotencyKey: 'booking-1',
    redirect: { success: 'https://bookly.ph/ok', failed: 'https://bookly.ph/no' },
    customer: { email: 'student@x.com' },
    metadata: { bookingId: 'booking-1' },
    ...o,
  } as CreateMarketplacePaymentDto;
}

describe('MarketplacePaymentsService (POST /v1/payments)', () => {
  let transactions: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let merchants: { requireMarketplace: jest.Mock; findOwned: jest.Mock };
  let splitRules: { getOrCreate: jest.Mock };
  let xendit: { createSplitInvoice: jest.Mock };
  let txLogger: { log: jest.Mock };
  let service: MarketplacePaymentsService;
  let saved: Transaction[];

  beforeEach(() => {
    saved = [];
    transactions = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((t) => ({ ...t })),
      save: jest.fn((t) => {
        const row = { id: t.id ?? 'tx-1', createdAt: new Date('2026-10-04T00:00:00Z'), ...t };
        saved.push({ ...row });
        Object.assign(t, row);
        return Promise.resolve(t);
      }),
    };
    merchants = {
      requireMarketplace: jest.fn(),
      findOwned: jest.fn().mockResolvedValue(merchant()),
    };
    splitRules = { getOrCreate: jest.fn().mockResolvedValue('splitru_12') };
    xendit = {
      createSplitInvoice: jest.fn().mockResolvedValue({
        id: 'inv-1', invoiceUrl: 'https://checkout.xendit.co/inv-1', created: new Date('2026-10-04T00:00:01Z'), raw: {},
      }),
    };
    txLogger = { log: jest.fn().mockResolvedValue(undefined) };
    service = new MarketplacePaymentsService(
      transactions as unknown as Repository<Transaction>,
      merchants as unknown as MerchantsService,
      splitRules as unknown as SplitRulesService,
      xendit as unknown as XenditPlatformClient,
      txLogger as unknown as TransactionLoggerService,
    );
  });

  it("charges ₱500 for BooklyPH at 12%: ₱60 platform, ₱440 merchant, invoice on the coach's sub-account", async () => {
    const view = await service.create(BOOKLY, dto());

    expect(view).toEqual(expect.objectContaining({
      id: 'tx-1', status: TransactionStatus.Pending, amount: 50000, currency: 'PHP', merchantId: 'm-1',
      platformFee: 6000, merchantAmount: 44000, feePercent: 12, checkoutUrl: 'https://checkout.xendit.co/inv-1',
    }));
    expect(splitRules.getOrCreate).toHaveBeenCalledWith(12, 'PHP');
    expect(xendit.createSplitInvoice).toHaveBeenCalledWith(expect.objectContaining({
      forUserId: 'sub-1',
      splitRuleId: 'splitru_12',
      externalId: 'tx-1',
      amount: 50000,
      currency: 'PHP',
      payerEmail: 'student@x.com',
      successRedirectUrl: 'https://bookly.ph/ok',
      failureRedirectUrl: 'https://bookly.ph/no',
      paymentMethods: null,
    }));
    const created = transactions.create.mock.calls[0][0];
    expect(created).toEqual(expect.objectContaining({
      appId: BOOKLY.id, provider: Provider.Xendit, type: TransactionType.Payment,
      merchantId: 'm-1', providerAccountId: 'sub-1', platformFeePercent: 12, platformFeeAmount: 6000,
      merchantAmount: 44000, idempotencyKey: 'booking-1',
    }));
    const final = saved[saved.length - 1];
    expect(final.providerTxId).toBe('inv-1');
    expect(final).toEqual(expect.objectContaining({ splitRuleId: 'splitru_12', splitStatus: 'pending' }));
    expect(txLogger.log.mock.calls.map((c) => c[0].action)).toEqual([LogAction.PaymentCreated, LogAction.PaymentProviderSent]);
  });

  it("offers only the app's chosen payment methods on its checkout", async () => {
    await service.create({ ...BOOKLY, paymentMethods: ['GCASH', 'PAYMAYA', 'QRPH'] } as App, dto());
    expect(xendit.createSplitInvoice).toHaveBeenCalledWith(expect.objectContaining({ paymentMethods: ['GCASH', 'PAYMAYA', 'QRPH'] }));
  });

  it('uses the founding-coach override while it runs', async () => {
    merchants.findOwned.mockResolvedValue(merchant({ feeOverridePercent: 10, feeOverrideEndsAt: new Date(Date.now() + 86_400_000) }));
    const view = await service.create(BOOKLY, dto());
    expect(view).toEqual(expect.objectContaining({ feePercent: 10, platformFee: 5000, merchantAmount: 45000 }));
    expect(splitRules.getOrCreate).toHaveBeenCalledWith(10, 'PHP');
  });

  it('skips the split rule entirely at 0%', async () => {
    merchants.findOwned.mockResolvedValue(merchant({ feeOverridePercent: 0 }));
    await service.create(BOOKLY, dto());
    expect(splitRules.getOrCreate).not.toHaveBeenCalled();
    expect(xendit.createSplitInvoice).toHaveBeenCalledWith(expect.objectContaining({ splitRuleId: null }));
  });

  it('rejects apps without marketplace mode', async () => {
    merchants.requireMarketplace.mockImplementation(() => { throw new ForbiddenException(); });
    await expect(service.create({ ...BOOKLY, marketplaceEnabled: false } as App, dto())).rejects.toBeInstanceOf(ForbiddenException);
    expect(xendit.createSplitInvoice).not.toHaveBeenCalled();
  });

  it("404s another app's merchant (tenant boundary)", async () => {
    merchants.findOwned.mockRejectedValue(new NotFoundException());
    await expect(service.create(BOOKLY, dto())).rejects.toBeInstanceOf(NotFoundException);
    expect(transactions.save).not.toHaveBeenCalled();
  });

  it.each([MerchantStatus.Pending, MerchantStatus.Paused, MerchantStatus.Suspended])('rejects a %s merchant', async (status) => {
    merchants.findOwned.mockResolvedValue(merchant({ status }));
    await expect(service.create(BOOKLY, dto())).rejects.toMatchObject({ response: { error: 'merchant_not_active' } });
    expect(transactions.save).not.toHaveBeenCalled();
  });

  it('rejects an active merchant with no sub-account', async () => {
    merchants.findOwned.mockResolvedValue(merchant({ xenditAccountId: null }));
    await expect(service.create(BOOKLY, dto())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the app has no fee configured', async () => {
    await expect(service.create({ ...BOOKLY, marketplaceFeePercent: null } as App, dto()))
      .rejects.toMatchObject({ response: { error: 'marketplace_fee_not_set' } });
    expect(transactions.save).not.toHaveBeenCalled();
  });

  it('returns the original payment for a repeated idempotency key without calling Xendit', async () => {
    transactions.findOne.mockResolvedValue({
      id: 'tx-old', appId: BOOKLY.id, merchantId: 'm-1', amount: 50000, currency: 'PHP', status: TransactionStatus.Pending,
      platformFeeAmount: 6000, merchantAmount: 44000, platformFeePercent: 12, checkoutUrl: 'https://old', createdAt: new Date(),
    });
    const view = await service.create(BOOKLY, dto());
    expect(view).toEqual(expect.objectContaining({ id: 'tx-old', checkoutUrl: 'https://old' }));
    expect(transactions.findOne).toHaveBeenCalledWith({ where: { appId: BOOKLY.id, idempotencyKey: 'booking-1' } });
    expect(xendit.createSplitInvoice).not.toHaveBeenCalled();
  });

  it.each([
    [{ merchantId: 'm-other', amount: 50000 }],
    [{ merchantId: 'm-1', amount: 70000 }],
  ])('409s an idempotency key reused for a different charge (%j)', async (existing) => {
    transactions.findOne.mockResolvedValue({ id: 'tx-old', ...existing });
    await expect(service.create(BOOKLY, dto())).rejects.toBeInstanceOf(ConflictException);
  });

  it('marks the transaction failed when Xendit rejects the invoice', async () => {
    xendit.createSplitInvoice.mockRejectedValue(new Error('Xendit POST /v2/invoices failed (400)'));
    await expect(service.create(BOOKLY, dto())).rejects.toThrow(/Xendit/);
    const last = saved[saved.length - 1];
    expect(last.status).toBe(TransactionStatus.Failed);
    expect(last.splitStatus).toBeNull();
  });

  it('saves a Failed row (with the reason) when the split rule cannot be created', async () => {
    splitRules.getOrCreate.mockRejectedValue(new Error('The API key provided is invalid.'));
    await expect(service.create(BOOKLY, dto())).rejects.toThrow(/API key/);

    // The row exists before Xendit is touched, so the failure is visible in the admin.
    expect(transactions.create).toHaveBeenCalledTimes(1);
    const last = saved[saved.length - 1];
    expect(last).toEqual(expect.objectContaining({
      status: TransactionStatus.Failed, splitRuleId: null, splitStatus: null,
    }));
    expect(xendit.createSplitInvoice).not.toHaveBeenCalled();
    const failedLog = txLogger.log.mock.calls.map((c) => c[0]).find((l) => l.action === LogAction.PaymentFailed);
    expect(failedLog.details).toEqual({ stage: 'provider_send', error: 'The API key provided is invalid.' });
  });

  it('a retry after a split-rule failure resolves the rule and invoices the same row', async () => {
    transactions.findOne.mockResolvedValue({
      id: 'tx-failed', appId: BOOKLY.id, merchantId: 'm-1', amount: 50000, currency: 'PHP',
      status: TransactionStatus.Failed, providerTxId: null, splitRuleId: null, splitStatus: null,
      platformFeeAmount: 6000, merchantAmount: 44000, platformFeePercent: 12, checkoutUrl: null,
      description: 'Session', createdAt: new Date(),
    });
    const view = await service.create(BOOKLY, dto());
    expect(view).toEqual(expect.objectContaining({ id: 'tx-failed', status: TransactionStatus.Pending }));
    expect(splitRules.getOrCreate).toHaveBeenCalledWith(12, 'PHP');
    expect(xendit.createSplitInvoice).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'tx-failed', splitRuleId: 'splitru_12' }));
    expect(transactions.create).not.toHaveBeenCalled();
    expect(saved[saved.length - 1].splitStatus).toBe('pending');
  });

  it('re-invoices the same row when a retry follows a provider_error (no Xendit invoice yet)', async () => {
    const failed = {
      id: 'tx-failed', appId: BOOKLY.id, merchantId: 'm-1', amount: 50000, currency: 'PHP',
      status: TransactionStatus.Failed, providerTxId: null, splitRuleId: 'splitru_12', splitStatus: null,
      platformFeeAmount: 6000, merchantAmount: 44000, platformFeePercent: 12, checkoutUrl: null,
      description: 'Session', createdAt: new Date(),
    };
    transactions.findOne.mockResolvedValue(failed);
    const view = await service.create(BOOKLY, dto());
    expect(view).toEqual(expect.objectContaining({
      id: 'tx-failed', status: TransactionStatus.Pending, checkoutUrl: 'https://checkout.xendit.co/inv-1', platformFee: 6000,
    }));
    expect(xendit.createSplitInvoice).toHaveBeenCalledWith(expect.objectContaining({
      externalId: 'tx-failed', splitRuleId: 'splitru_12', forUserId: 'sub-1', amount: 50000,
    }));
    // One row, re-used: no second insert, no new split rule lookup.
    expect(transactions.create).not.toHaveBeenCalled();
    expect(splitRules.getOrCreate).not.toHaveBeenCalled();
  });

  it('replays a failed payment that Xendit did invoice (expired) instead of re-invoicing', async () => {
    transactions.findOne.mockResolvedValue({
      id: 'tx-expired', appId: BOOKLY.id, merchantId: 'm-1', amount: 50000, currency: 'PHP',
      status: TransactionStatus.Failed, providerTxId: 'inv-old', checkoutUrl: 'https://old', createdAt: new Date(),
    });
    const view = await service.create(BOOKLY, dto());
    expect(view).toEqual(expect.objectContaining({ id: 'tx-expired', status: TransactionStatus.Failed }));
    expect(xendit.createSplitInvoice).not.toHaveBeenCalled();
  });

  it('a retry still refuses a merchant that is no longer active', async () => {
    transactions.findOne.mockResolvedValue({
      id: 'tx-failed', appId: BOOKLY.id, merchantId: 'm-1', amount: 50000, status: TransactionStatus.Failed, providerTxId: null,
    });
    merchants.findOwned.mockResolvedValue(merchant({ status: MerchantStatus.Paused }));
    await expect(service.create(BOOKLY, dto())).rejects.toMatchObject({ response: { error: 'merchant_not_active' } });
    expect(xendit.createSplitInvoice).not.toHaveBeenCalled();
  });

  it('returns the winner when a concurrent retry inserted the same key first', async () => {
    transactions.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'tx-winner', merchantId: 'm-1', amount: 50000, createdAt: new Date() });
    transactions.save.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "uq_tx_app_idem"'));
    const view = await service.create(BOOKLY, dto());
    expect(view.id).toBe('tx-winner');
    expect(xendit.createSplitInvoice).not.toHaveBeenCalled();
  });
});
