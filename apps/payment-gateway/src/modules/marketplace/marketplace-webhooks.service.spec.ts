jest.mock('../../database/entities', () => ({
  App: class App {}, Customer: class Customer {}, Plan: class Plan {}, Subscription: class Subscription {},
  Transaction: class Transaction {}, TransactionLog: class TransactionLog {}, User: class User {},
  WebhookEvent: class WebhookEvent {}, Merchant: class Merchant {}, Payout: class Payout {},
  PayoutRun: class PayoutRun {}, XenditSplitRule: class XenditSplitRule {},
}));

import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PayoutStatus, Provider } from '../../common/enums';
import { Merchant, Transaction } from '../../database/entities';
import { XenditAdapter } from '../../payment-providers/xendit.adapter';
import { MarketplaceWebhooksService } from './marketplace-webhooks.service';
import { MerchantsService } from './merchants.service';
import { PayoutRunsService } from './payout-runs.service';

const TX_ID = '11111111-2222-4333-8444-555555555555';

describe('MarketplaceWebhooksService (/v1/webhooks/xendit/marketplace)', () => {
  let merchants: { findOne: jest.Mock };
  let transactions: { findOne: jest.Mock; save: jest.Mock };
  let adapter: { verifyWebhook: jest.Mock };
  let merchantsService: { applyAccountStatus: jest.Mock };
  let payoutRuns: { applyWebhook: jest.Mock };
  let service: MarketplaceWebhooksService;

  const send = (payload: unknown, token = 'tok') => service.handle(Buffer.from(JSON.stringify(payload)), token);

  beforeEach(() => {
    merchants = { findOne: jest.fn().mockResolvedValue(null) };
    transactions = { findOne: jest.fn().mockResolvedValue(null), save: jest.fn((t) => Promise.resolve(t)) };
    adapter = {
      verifyWebhook: jest.fn((raw: Buffer, token?: string) => {
        if (token !== 'tok') throw new Error('Invalid Xendit webhook token');
        return JSON.parse(raw.toString());
      }),
    };
    merchantsService = { applyAccountStatus: jest.fn().mockResolvedValue(undefined) };
    payoutRuns = { applyWebhook: jest.fn().mockResolvedValue({ matched: true, changed: true }) };
    service = new MarketplaceWebhooksService(
      merchants as unknown as Repository<Merchant>,
      transactions as unknown as Repository<Transaction>,
      adapter as unknown as XenditAdapter,
      merchantsService as unknown as MerchantsService,
      payoutRuns as unknown as PayoutRunsService,
    );
  });

  it('rejects a bad callback token with 400', async () => {
    await expect(send({ event: 'payout.succeeded' }, 'wrong')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('routes payout callbacks to the payout runs engine', async () => {
    const r = await send({ event: 'payout.succeeded', data: { id: 'disb-1', reference_id: 'po-1', status: 'SUCCEEDED' } });
    expect(payoutRuns.applyWebhook).toHaveBeenCalledWith(expect.objectContaining({
      xenditPayoutId: 'disb-1', referenceId: 'po-1', status: PayoutStatus.Succeeded,
    }));
    expect(r).toEqual(expect.objectContaining({ ok: true, kind: 'payout', matched: true }));
  });

  it('applies account status to the matching merchant', async () => {
    const m = { id: 'm-1' };
    merchants.findOne.mockResolvedValue(m);
    await send({ event: 'account.created', data: { id: 'sub-1', status: 'LIVE' } });
    expect(merchants.findOne).toHaveBeenCalledWith({ where: { xenditAccountId: 'sub-1' } });
    expect(merchantsService.applyAccountStatus).toHaveBeenCalledWith(m, 'LIVE', expect.any(Object));
  });

  it('acks (200) an account it does not know instead of making Xendit retry forever', async () => {
    const r = await send({ event: 'account.updated', data: { id: 'sub-x', status: 'LIVE' } });
    expect(r).toEqual(expect.objectContaining({ ok: true, matched: false }));
  });

  it('records the actual split amount on the transaction', async () => {
    const tx = { id: TX_ID, merchantId: 'm-1', amount: 50000, platformFeeAmount: 6000, merchantAmount: 44000, metadata: {} };
    transactions.findOne.mockResolvedValue(tx);
    await send({ event: 'split.payment', data: { id: 'sp-1', status: 'COMPLETED', amount: 60.01, payment_reference_id: TX_ID } });
    expect(transactions.findOne).toHaveBeenCalledWith({ where: { id: TX_ID } });
    expect(tx).toEqual(expect.objectContaining({ splitStatus: 'completed', platformFeeAmount: 6001, merchantAmount: 43999 }));
  });

  it('falls back to the Xendit payment id when the reference is not ours', async () => {
    await send({ event: 'split.payment', data: { id: 'sp-1', status: 'FAILED', payment_id: 'py-1', payment_reference_id: 'not-uuid' } });
    expect(transactions.findOne).toHaveBeenCalledWith({ where: { providerTxId: 'py-1', provider: Provider.Xendit } });
  });

  it('marks a failed split without touching the amounts', async () => {
    const tx = { id: TX_ID, merchantId: 'm-1', amount: 50000, platformFeeAmount: 6000, merchantAmount: 44000, metadata: {} };
    transactions.findOne.mockResolvedValue(tx);
    await send({ event: 'split.payment', data: { id: 'sp-1', status: 'FAILED', failure_code: 'INSUFFICIENT_BALANCE', payment_reference_id: TX_ID } });
    expect(tx).toEqual(expect.objectContaining({ splitStatus: 'failed', platformFeeAmount: 6000 }));
  });

  it('ignores a split for a non-marketplace transaction', async () => {
    transactions.findOne.mockResolvedValue({ id: TX_ID, merchantId: null });
    const r = await send({ event: 'split.payment', data: { id: 'sp-1', status: 'COMPLETED', payment_reference_id: TX_ID } });
    expect(r).toEqual(expect.objectContaining({ matched: false }));
    expect(transactions.save).not.toHaveBeenCalled();
  });

  it('acks unknown events', async () => {
    expect(await send({ event: 'something.else', data: {} })).toEqual({ ok: true, kind: 'unknown' });
  });
});
