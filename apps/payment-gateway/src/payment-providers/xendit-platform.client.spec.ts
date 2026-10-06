import { ConfigService } from '@nestjs/config';
import { PayoutStatus } from '../common/enums';

const mockBalance = { getBalance: jest.fn() };
const mockPayout = {
  createPayout: jest.fn(),
  getPayoutById: jest.fn(),
  getPayouts: jest.fn(),
  getPayoutChannels: jest.fn(),
};
jest.mock('xendit-node', () => ({
  Xendit: jest.fn().mockImplementation(() => ({ Balance: mockBalance, Payout: mockPayout })),
}));

const mockRequest = jest.fn();
jest.mock('axios', () => ({ __esModule: true, default: { request: (...a: unknown[]) => mockRequest(...a) } }));

import {
  mapPayoutStatus, parseMarketplaceWebhook, XenditPlatformClient,
} from './xendit-platform.client';

function makeClient(env: Record<string, string | undefined> = {}) {
  const all: Record<string, string | undefined> = {
    XENDIT_SECRET_KEY: 'xnd_key',
    XENDIT_PLATFORM_ACCOUNT_ID: 'master-biz-1',
    ...env,
  };
  return new XenditPlatformClient({ get: (k: string) => all[k] } as unknown as ConfigService);
}

describe('XenditPlatformClient', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createOwnedAccount', () => {
    it('creates an OWNED sub-account over HTTP with basic auth', async () => {
      mockRequest.mockResolvedValue({ data: { id: 'sub-1', status: 'live' } });
      const acct = await makeClient().createOwnedAccount({ email: 'coach@x.com', businessName: 'Coach Juan' });
      expect(acct).toEqual(expect.objectContaining({ id: 'sub-1', status: 'LIVE' }));
      const req = mockRequest.mock.calls[0][0];
      expect(req).toEqual(expect.objectContaining({
        method: 'POST',
        url: 'https://api.xendit.co/v2/accounts',
        auth: { username: 'xnd_key', password: '' },
        data: { email: 'coach@x.com', type: 'OWNED', public_profile: { business_name: 'Coach Juan' } },
      }));
    });

    it('wraps Xendit errors with status + code, mentioning Xendit (→ 502)', async () => {
      mockRequest.mockRejectedValue({
        message: 'Request failed',
        response: { status: 400, data: { error_code: 'API_VALIDATION_ERROR', message: 'email invalid' } },
      });
      await expect(makeClient().createOwnedAccount({ email: 'x', businessName: 'y' }))
        .rejects.toMatchObject({ status: 400, code: 'API_VALIDATION_ERROR', message: expect.stringContaining('Xendit') });
    });
  });

  describe('createPlatformFeeSplitRule', () => {
    it('routes the percent to the platform (master) account', async () => {
      mockRequest.mockResolvedValue({ data: { id: 'splitru_1' } });
      const id = await makeClient().createPlatformFeeSplitRule({ percent: 12, currency: 'php' });
      expect(id).toBe('splitru_1');
      const { data } = mockRequest.mock.calls[0][0];
      expect(data.routes).toEqual([{
        percent_amount: 12,
        currency: 'PHP',
        destination_account_id: 'master-biz-1',
        reference_id: 'acepay-platform-fee-12-PHP',
      }]);
    });

    it('names the rule in words Xendit accepts: letters, digits and spaces only', async () => {
      mockRequest.mockResolvedValue({ data: { id: 'splitru_2' } });
      await makeClient().createPlatformFeeSplitRule({ percent: 12.5, currency: 'PHP' });
      const { data } = mockRequest.mock.calls[0][0];
      expect(data.name).toBe('AcePay platform fee 12 point 5 percent');
      expect(data.name).toMatch(/^[a-zA-Z0-9 ]+$/);
      expect(data.description).toMatch(/^[a-zA-Z0-9 ]+$/);
    });

    it('refuses to run without XENDIT_PLATFORM_ACCOUNT_ID', async () => {
      await expect(makeClient({ XENDIT_PLATFORM_ACCOUNT_ID: undefined }).createPlatformFeeSplitRule({ percent: 12, currency: 'PHP' }))
        .rejects.toThrow(/XENDIT_PLATFORM_ACCOUNT_ID/);
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });

  describe('createSplitInvoice', () => {
    const base = {
      forUserId: 'sub-1',
      splitRuleId: 'splitru_1',
      externalId: 'tx-1',
      amount: 50000,
      currency: 'php',
      description: 'Session',
      payerEmail: 'student@x.com',
      successRedirectUrl: 'https://b.ph/ok',
      failureRedirectUrl: 'https://b.ph/no',
      metadata: { acepay_tx: 'tx-1' },
    };

    it('creates the invoice ON the sub-account with the split rule, in MAJOR units', async () => {
      mockRequest.mockResolvedValue({ data: { id: 'inv-1', invoice_url: 'https://checkout/inv-1', created: '2026-10-04T00:00:00Z' } });
      const inv = await makeClient().createSplitInvoice(base);
      expect(inv).toEqual(expect.objectContaining({ id: 'inv-1', invoiceUrl: 'https://checkout/inv-1' }));
      const req = mockRequest.mock.calls[0][0];
      expect(req.url).toBe('https://api.xendit.co/v2/invoices');
      expect(req.headers).toEqual(expect.objectContaining({ 'for-user-id': 'sub-1', 'with-split-rule': 'splitru_1' }));
      expect(req.data).toEqual(expect.objectContaining({ external_id: 'tx-1', amount: 500, currency: 'PHP', payer_email: 'student@x.com' }));
    });

    it("offers only the app's payment methods when it has a list, and every method when it has none", async () => {
      mockRequest.mockResolvedValue({ data: { id: 'inv-1', invoice_url: 'u' } });
      await makeClient().createSplitInvoice({ ...base, paymentMethods: ['GCASH', 'QRPH'] });
      expect(mockRequest.mock.calls[0][0].data.payment_methods).toEqual(['GCASH', 'QRPH']);
      await makeClient().createSplitInvoice({ ...base, paymentMethods: null });
      expect(mockRequest.mock.calls[1][0].data).not.toHaveProperty('payment_methods');
    });

    it('omits the split header for a 0% fee', async () => {
      mockRequest.mockResolvedValue({ data: { id: 'inv-1', invoice_url: 'u' } });
      await makeClient().createSplitInvoice({ ...base, splitRuleId: null });
      expect(mockRequest.mock.calls[0][0].headers).not.toHaveProperty('with-split-rule');
    });

    it('throws when Xendit returns no URL', async () => {
      mockRequest.mockResolvedValue({ data: { id: 'inv-1' } });
      await expect(makeClient().createSplitInvoice(base)).rejects.toThrow(/invoice URL/);
    });
  });

  describe('balances + payouts on behalf of a sub-account', () => {
    it('reads the CASH balance for the sub-account and returns MINOR units', async () => {
      mockBalance.getBalance.mockResolvedValue({ balance: 1234.56 });
      expect(await makeClient().getBalance('sub-1', 'php')).toBe(123456);
      expect(mockBalance.getBalance).toHaveBeenCalledWith({ accountType: 'CASH', currency: 'PHP', forUserId: 'sub-1' });
    });

    it('sends a payout from the sub-account in MAJOR units, keyed by our id', async () => {
      mockPayout.createPayout.mockResolvedValue({ id: 'disb-1', referenceId: 'po-1', status: 'ACCEPTED' });
      const r = await makeClient().createPayout({
        forUserId: 'sub-1', referenceId: 'po-1', channelCode: 'PH_GCASH', accountNumber: '0917',
        accountHolderName: 'Juan', amount: 485000, currency: 'PHP', description: 'BooklyPH payout', email: 'c@x.com',
      });
      expect(r).toEqual(expect.objectContaining({ id: 'disb-1', status: PayoutStatus.Pending, providerStatus: 'ACCEPTED' }));
      const call = mockPayout.createPayout.mock.calls[0][0];
      expect(call.idempotencyKey).toBe('po-1');
      expect(call.forUserId).toBe('sub-1');
      expect(call.data).toEqual(expect.objectContaining({
        referenceId: 'po-1', channelCode: 'PH_GCASH', amount: 4850, currency: 'PHP',
        channelProperties: { accountNumber: '0917', accountHolderName: 'Juan' },
        receiptNotification: { emailTo: ['c@x.com'] },
      }));
    });

    it('finds a payout by reference on the sub-account (lost response)', async () => {
      mockPayout.getPayouts.mockResolvedValue({ data: [{ id: 'disb-1', status: 'SUCCEEDED' }] });
      const r = await makeClient().findPayoutByReference('po-1', 'sub-1');
      expect(r?.status).toBe(PayoutStatus.Succeeded);
      expect(mockPayout.getPayouts).toHaveBeenCalledWith({ referenceId: 'po-1', limit: 1, forUserId: 'sub-1' });
    });

    it('returns null when Xendit never created it', async () => {
      mockPayout.getPayouts.mockResolvedValue({ data: [] });
      expect(await makeClient().findPayoutByReference('po-1', 'sub-1')).toBeNull();
    });

    it.each([
      [undefined, 2500],
      ['0', 0],
      ['4000', 4000],
      ['-5', 2500],
      ['abc', 2500],
      ['12.5', 2500],
    ])('payout fee reserve %s → %i', (raw, expected) => {
      expect(makeClient({ XENDIT_PAYOUT_FEE_RESERVE: raw }).payoutFeeReserve()).toBe(expected);
    });
  });
});

describe('mapPayoutStatus', () => {
  it.each([
    ['REQUESTED', PayoutStatus.Pending],
    ['ACCEPTED', PayoutStatus.Pending],
    ['LOCKED', PayoutStatus.Pending],
    ['PENDING_COMPLIANCE', PayoutStatus.Pending],
    ['SUCCEEDED', PayoutStatus.Succeeded],
    ['FAILED', PayoutStatus.Failed],
    ['REJECTED', PayoutStatus.Failed],
    ['CANCELLED', PayoutStatus.Canceled],
    ['REVERSED', PayoutStatus.Reversed],
    ['succeeded', PayoutStatus.Succeeded],
  ])('%s → %s', (raw, mapped) => expect(mapPayoutStatus(raw)).toBe(mapped));
});

describe('parseMarketplaceWebhook', () => {
  it('parses a v2 payout callback', () => {
    const e = parseMarketplaceWebhook({
      event: 'payout.failed',
      data: { id: 'disb-1', reference_id: 'po-1', status: 'FAILED', failure_code: 'INVALID_DESTINATION' },
    });
    expect(e).toEqual(expect.objectContaining({
      kind: 'payout', xenditPayoutId: 'disb-1', referenceId: 'po-1',
      status: PayoutStatus.Failed, failureCode: 'INVALID_DESTINATION',
    }));
  });

  it('parses a v3 payout callback (payout_id, rejected)', () => {
    const e = parseMarketplaceWebhook({ event: 'v3_payout.rejected', data: { payout_id: 'po-x', reference_id: 'r' } });
    expect(e).toEqual(expect.objectContaining({ kind: 'payout', xenditPayoutId: 'po-x', status: PayoutStatus.Failed }));
  });

  it('parses a reversed payout', () => {
    const e = parseMarketplaceWebhook({ event: 'payout.reversed', data: { id: 'd', status: 'REVERSED' } });
    expect(e).toEqual(expect.objectContaining({ kind: 'payout', status: PayoutStatus.Reversed }));
  });

  it('parses an account callback', () => {
    const e = parseMarketplaceWebhook({ event: 'account.created', data: { id: 'sub-1', status: 'live' } });
    expect(e).toEqual(expect.objectContaining({ kind: 'account', accountId: 'sub-1', providerStatus: 'LIVE' }));
  });

  it('parses a split callback into minor units', () => {
    const e = parseMarketplaceWebhook({
      event: 'split.payment',
      data: { id: 'sp-1', status: 'COMPLETED', amount: 60, payment_id: 'py-1', payment_reference_id: 'tx-1' },
    });
    expect(e).toEqual(expect.objectContaining({
      kind: 'split', status: 'completed', amount: 6000, paymentId: 'py-1', paymentReferenceId: 'tx-1',
    }));
  });

  it('maps a failed split', () => {
    const e = parseMarketplaceWebhook({ event: 'split.payment', data: { id: 'sp-1', status: 'FAILED', failure_code: 'INSUFFICIENT_BALANCE' } });
    expect(e).toEqual(expect.objectContaining({ kind: 'split', status: 'failed', failureCode: 'INSUFFICIENT_BALANCE' }));
  });

  it.each([
    [{ event: 'invoice.paid', data: {} }],
    [{ event: 'payout.succeeded', data: {} }],
    [null],
    ['garbage'],
  ])('returns unknown for %j', (payload) => {
    expect(parseMarketplaceWebhook(payload).kind).toBe('unknown');
  });
});
