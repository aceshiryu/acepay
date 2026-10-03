import { ConfigService } from '@nestjs/config';
import { TransactionStatus } from '../common/enums';

// Mock the xendit-node SDK. The adapter does `new Xendit({...})` then calls
// client.Invoice.*, client.Refund.*, client.PaymentRequest.*, client.Customer.*
const mockInvoice = { getInvoiceById: jest.fn(), createInvoice: jest.fn() };
const mockRefund = { createRefund: jest.fn() };
const mockPaymentRequest = { createPaymentRequest: jest.fn() };
const mockCustomer = { getCustomerByReferenceID: jest.fn(), createCustomer: jest.fn() };
const mockPaymentMethod = { createPaymentMethod: jest.fn(), getPaymentMethodByID: jest.fn() };

jest.mock('xendit-node', () => ({
  Xendit: jest.fn().mockImplementation(() => ({
    Invoice: mockInvoice,
    Refund: mockRefund,
    PaymentRequest: mockPaymentRequest,
    Customer: mockCustomer,
    PaymentMethod: mockPaymentMethod,
  })),
}));

import { XenditAdapter } from './xendit.adapter';

const WEBHOOK_TOKEN = 'xnd_callback_token';

function makeConfig(overrides: Record<string, string | undefined> = {}): ConfigService {
  const env: Record<string, string | undefined> = {
    XENDIT_SECRET_KEY: 'xnd_key',
    XENDIT_WEBHOOK_TOKEN: WEBHOOK_TOKEN,
    ...overrides,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService;
}

/** A minimal successful createInvoice response. */
function invoiceOk(overrides: Record<string, unknown> = {}) {
  return { id: 'inv_1', invoiceUrl: 'https://checkout.xendit.co/inv_1', ...overrides };
}

function paymentParams(overrides: Record<string, unknown> = {}) {
  return {
    acepayTxId: 'tx-1',
    appSlug: 'savi',
    amount: 29900,
    currency: 'PHP',
    redirect: { success: 'https://savi.app/ok', failed: 'https://savi.app/no' },
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function subscriptionParams(overrides: Record<string, unknown> = {}) {
  return {
    acepaySubscriptionId: 'sub-1',
    appSlug: 'savi',
    providerPlanId: 'variant-1',
    customer: { email: 'buyer@example.com', name: 'Buyer' },
    redirect: { success: 'https://savi.app/ok', failed: 'https://savi.app/no' },
    metadata: { plan_amount: 49900, plan_currency: 'PHP' },
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** The `data` object handed to a mocked SDK call. */
function dataOf(mock: jest.Mock, call = 0): Record<string, unknown> {
  return mock.mock.calls[call][0].data as Record<string, unknown>;
}

describe('XenditAdapter', () => {
  let adapter: XenditAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new XenditAdapter(makeConfig());
  });

  describe('verifyWebhook (A3) — static token compare', () => {
    it('accepts a matching x-callback-token and parses the body', () => {
      const body = Buffer.from(JSON.stringify({ id: 'inv_1', status: 'PAID' }));
      const parsed = adapter.verifyWebhook(body, WEBHOOK_TOKEN);
      expect(parsed.id).toBe('inv_1');
      expect(parsed.status).toBe('PAID');
    });

    it('rejects a wrong token', () => {
      expect(() => adapter.verifyWebhook(Buffer.from('{}'), 'nope')).toThrow(/Invalid Xendit webhook token/);
    });

    it('rejects a missing token', () => {
      expect(() => adapter.verifyWebhook(Buffer.from('{}'), undefined)).toThrow(/Missing x-callback-token/);
    });
  });

  describe('normalizeEvent', () => {
    it('maps a PAID one-time invoice to payment.succeeded', () => {
      const n = adapter.normalizeEvent({
        id: 'inv_1',
        status: 'PAID',
        external_id: 'tx_1',
        metadata: { acepay_tx: 'tx_1' },
        paid_at: '2026-01-01T00:00:00Z',
      });
      expect(n.event).toBe('payment.succeeded');
      expect(n.status).toBe(TransactionStatus.Succeeded);
      expect(n.acepayTxId).toBe('tx_1');
      expect(n.providerSubscriptionId).toBeNull();
      expect(n.providerEventId).toBe('xendit_invoice_inv_1_paid');
    });

    it('maps a PAID subscription first-payment to subscription.created', () => {
      const n = adapter.normalizeEvent({
        id: 'inv_2',
        status: 'PAID',
        metadata: { acepay_subscription: 'sub_9' },
      });
      expect(n.event).toBe('subscription.created');
      expect(n.acepaySubscriptionId).toBe('sub_9');
      expect(n.providerSubscriptionId).toBe('inv_2');
    });

    it('maps an EXPIRED subscription invoice to subscription.payment_failed', () => {
      const n = adapter.normalizeEvent({
        id: 'inv_3',
        status: 'EXPIRED',
        metadata: { acepay_subscription: 'sub_9' },
      });
      expect(n.event).toBe('subscription.payment_failed');
      expect(n.status).toBe(TransactionStatus.Failed);
    });

    it('maps an EXPIRED one-time invoice to payment.failed', () => {
      const n = adapter.normalizeEvent({ id: 'inv_4', status: 'EXPIRED', metadata: {} });
      expect(n.event).toBe('payment.failed');
      expect(n.status).toBe(TransactionStatus.Failed);
    });
  });

  // Rewritten after UAT. The old implementation fetched the invoice to resolve a
  // `payment_id` and refunded against it as a paymentRequestId. Xendit's Invoice
  // resource exposes no such field — confirmed by fetching a genuinely PAID
  // invoice through the SDK — so every refund failed. CreateRefund accepts
  // invoiceId directly, which is what the adapter now sends.
  describe('refund — straight against the invoice', () => {
    beforeEach(() => mockRefund.createRefund.mockResolvedValue({ id: 'refund_1' }));

    it('refunds the invoice itself, with no invoice lookup first', async () => {
      const res = await adapter.refund('inv_1', 29900);
      expect(mockInvoice.getInvoiceById).not.toHaveBeenCalled();
      expect(mockRefund.createRefund).toHaveBeenCalledWith({
        // 29900 centavos -> 299 major units for Xendit.
        data: expect.objectContaining({ invoiceId: 'inv_1', amount: 299 }),
      });
      expect(res.providerRefundId).toBe('refund_1');
      expect(res.status).toBe(TransactionStatus.Pending);
    });

    it("refunds a marketplace payment on the merchant's sub-account", async () => {
      await adapter.refund('inv_1', 29900, { forUserId: 'sub-1' });
      expect(mockRefund.createRefund).toHaveBeenCalledWith({
        forUserId: 'sub-1',
        data: expect.objectContaining({ invoiceId: 'inv_1', amount: 299 }),
      });
    });

    it("reads a marketplace invoice on the merchant's sub-account", async () => {
      mockInvoice.getInvoiceById.mockResolvedValue({ id: 'inv_1', status: 'PENDING' });
      await adapter.getPayment('inv_1', { forUserId: 'sub-1' });
      expect(mockInvoice.getInvoiceById).toHaveBeenCalledWith({ invoiceId: 'inv_1', forUserId: 'sub-1' });
    });

    it('sends no amount for a full refund', async () => {
      await adapter.refund('inv_1');
      expect(dataOf(mockRefund.createRefund).amount).toBeUndefined();
      expect(dataOf(mockRefund.createRefund).invoiceId).toBe('inv_1');
    });

    it('tags the refund reason Xendit expects', async () => {
      await adapter.refund('inv_1', 5000);
      expect(dataOf(mockRefund.createRefund).reason).toBe('REQUESTED_BY_CUSTOMER');
    });

    it('converts a partial amount to major units', async () => {
      await adapter.refund('inv_1', 5000);
      expect(dataOf(mockRefund.createRefund).amount).toBe(50);
    });

    it('surfaces a provider rejection rather than swallowing it', async () => {
      mockRefund.createRefund.mockRejectedValue(new Error('[Xendit SDK Error] 400 Bad Request'));
      await expect(adapter.refund('inv_1', 5000)).rejects.toThrow('400 Bad Request');
    });

    it('tolerates a refund response with no id', async () => {
      mockRefund.createRefund.mockResolvedValue({});
      await expect(adapter.refund('inv_1', 5000)).resolves.toMatchObject({ providerRefundId: '' });
    });
  });

  describe('chargeWithPaymentMethod (recurring cycle)', () => {
    it('charges the saved PM in major units and normalizes the status', async () => {
      mockPaymentRequest.createPaymentRequest.mockResolvedValue({ id: 'pr_1', status: 'SUCCEEDED' });
      const res = await adapter.chargeWithPaymentMethod({
        paymentMethodId: 'pm_1',
        xenditCustomerId: 'cus_1',
        amount: 49900,
        currency: 'php',
        referenceId: 'sub_9_cycle_2',
        metadata: { acepay_subscription: 'sub_9' },
      });
      expect(mockPaymentRequest.createPaymentRequest).toHaveBeenCalledWith({
        data: expect.objectContaining({ amount: 499, currency: 'PHP', paymentMethod: { id: 'pm_1' } }),
      });
      expect(res.status).toBe('SUCCEEDED');
      expect(res.paymentRequestId).toBe('pr_1');
    });

    it('defaults to PENDING when the provider omits a status', async () => {
      mockPaymentRequest.createPaymentRequest.mockResolvedValue({ id: 'pr_2' });
      const res = await adapter.chargeWithPaymentMethod({
        paymentMethodId: 'pm_1', xenditCustomerId: 'cus_1', amount: 100,
        currency: 'PHP', referenceId: 'ref', metadata: {},
      });
      expect(res.status).toBe('PENDING');
    });
  });

  describe('pause/resume (AcePay-managed, no provider call)', () => {
    it('pauseSubscription reports paused status', async () => {
      const r = await adapter.pauseSubscription('sub_1');
      expect(String(r.status)).toBe('paused');
      expect(r.providerSubscriptionId).toBe('sub_1');
    });

    it('resumeSubscription reports active status', async () => {
      const r = await adapter.resumeSubscription('sub_1');
      expect(String(r.status)).toBe('active');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Edge cases below: money conversion, env wiring, customer resolution,
  // subscription creation and the status-mapping defaults.
  // ─────────────────────────────────────────────────────────────────────

  describe('env wiring', () => {
    it('throws a named error when XENDIT_SECRET_KEY is missing', async () => {
      const a = new XenditAdapter(makeConfig({ XENDIT_SECRET_KEY: undefined }));
      await expect(a.getPayment('inv_1')).rejects.toThrow('XENDIT_SECRET_KEY env var is not set');
    });

    it('throws a named error when XENDIT_WEBHOOK_TOKEN is missing', () => {
      const a = new XenditAdapter(makeConfig({ XENDIT_WEBHOOK_TOKEN: undefined }));
      expect(() => a.verifyWebhook(Buffer.from('{}'), 'anything'))
        .toThrow('XENDIT_WEBHOOK_TOKEN env var is not set');
    });
  });

  describe('createPayment — MAJOR unit conversion (the Xendit gotcha)', () => {
    beforeEach(() => mockInvoice.createInvoice.mockResolvedValue(invoiceOk()));

    // Xendit takes major units while AcePay stores minor units everywhere else.
    // Getting this wrong charges 100x too much, so pin the arithmetic exactly.
    it.each([
      [29900, 299],
      [49900, 499],
      [100, 1],
      [1, 0.01],
      [49999, 499.99],
      [5, 0.05],
      [123456789, 1234567.89],
    ])('sends minor %i as major %s', async (minor, major) => {
      await adapter.createPayment(paymentParams({ amount: minor }));
      expect(dataOf(mockInvoice.createInvoice).amount).toBe(major);
    });

    it('uppercases the currency', async () => {
      await adapter.createPayment(paymentParams({ currency: 'php' }));
      expect(dataOf(mockInvoice.createInvoice).currency).toBe('PHP');
    });

    it('uses the AcePay transaction id as the external id', async () => {
      await adapter.createPayment(paymentParams());
      expect(dataOf(mockInvoice.createInvoice).externalId).toBe('tx-1');
    });

    it('falls back to a generated description', async () => {
      await adapter.createPayment(paymentParams({ description: undefined }));
      expect(dataOf(mockInvoice.createInvoice).description).toBe('Payment for savi');
    });

    it('passes both redirect URLs through', async () => {
      await adapter.createPayment(paymentParams());
      const data = dataOf(mockInvoice.createInvoice);
      expect(data.successRedirectUrl).toBe('https://savi.app/ok');
      expect(data.failureRedirectUrl).toBe('https://savi.app/no');
    });

    it('always tags the invoice with the AcePay tx and app slug', async () => {
      await adapter.createPayment(paymentParams({ metadata: { userId: 'u1' } }));
      expect(dataOf(mockInvoice.createInvoice).metadata).toMatchObject({
        acepay_tx: 'tx-1', app_slug: 'savi', userId: 'u1',
      });
    });

    it('omits payerEmail when there is no customer', async () => {
      await adapter.createPayment(paymentParams({ customer: undefined }));
      expect(dataOf(mockInvoice.createInvoice).payerEmail).toBeUndefined();
    });

    it('returns the invoice id and hosted checkout URL', async () => {
      const res = await adapter.createPayment(paymentParams());
      expect(res.providerTxId).toBe('inv_1');
      expect(res.checkoutUrl).toBe('https://checkout.xendit.co/inv_1');
    });

    it('uses the provider created timestamp when present', async () => {
      mockInvoice.createInvoice.mockResolvedValue(invoiceOk({ created: '2026-02-03T04:05:06Z' }));
      const res = await adapter.createPayment(paymentParams());
      expect(res.providerCreatedAt.toISOString()).toBe('2026-02-03T04:05:06.000Z');
    });

    it('falls back to now when the provider omits a timestamp', async () => {
      const res = await adapter.createPayment(paymentParams());
      expect(res.providerCreatedAt).toBeInstanceOf(Date);
    });

    it.each([
      ['no invoice URL', invoiceOk({ invoiceUrl: undefined })],
      ['an empty invoice URL', invoiceOk({ invoiceUrl: '' })],
      ['a null response', null],
    ])('throws when the provider returns %s', async (_label, resp) => {
      mockInvoice.createInvoice.mockResolvedValue(resp);
      await expect(adapter.createPayment(paymentParams()))
        .rejects.toThrow('Xendit did not return an invoice URL');
    });
  });

  describe('createSubscription — first-cycle invoice', () => {
    beforeEach(() => {
      mockInvoice.createInvoice.mockResolvedValue(
        invoiceOk({ id: 'inv_sub_1', invoiceUrl: 'https://checkout.xendit.co/inv_sub_1' }),
      );
      mockCustomer.getCustomerByReferenceID.mockResolvedValue({ data: [{ id: 'xcus-1' }] });
    });

    it.each([
      ['a missing plan_amount', {}],
      ['a zero plan_amount', { plan_amount: 0 }],
      ['a non-numeric plan_amount', { plan_amount: 'lots' }],
    ])('refuses to create a subscription with %s', async (_label, metadata) => {
      await expect(adapter.createSubscription(subscriptionParams({ metadata })))
        .rejects.toThrow('metadata.plan_amount');
      expect(mockInvoice.createInvoice).not.toHaveBeenCalled();
    });

    it('converts the plan amount to major units and marks cycle 1', async () => {
      await adapter.createSubscription(subscriptionParams());
      const data = dataOf(mockInvoice.createInvoice);
      expect(data.amount).toBe(499);
      expect(data.externalId).toBe('sub_sub-1_cycle_1');
      expect(data.customerId).toBe('xcus-1');
    });

    // Kept because it costs nothing, but note it does NOT actually arm recurring:
    // a paid invoice returns a one-off credit_card_charge_id, never a reusable
    // payment method. Creating a CARD payment method instead is rejected by the
    // live API without card_information, which would mean PCI scope.
    it('still asks Xendit to save payment methods', async () => {
      await adapter.createSubscription(subscriptionParams());
      expect(dataOf(mockInvoice.createInvoice).shouldSavePaymentMethods).toBe(true);
    });

    it('returns the hosted checkout URL', async () => {
      const res = await adapter.createSubscription(subscriptionParams());
      expect(res.providerCheckoutId).toBe('inv_sub_1');
      expect(res.checkoutUrl).toBe('https://checkout.xendit.co/inv_sub_1');
    });

    it('throws when no checkout URL comes back', async () => {
      mockInvoice.createInvoice.mockResolvedValue(invoiceOk({ invoiceUrl: undefined }));
      await expect(adapter.createSubscription(subscriptionParams()))
        .rejects.toThrow('did not return an invoice URL for subscription first-payment');
    });
  });

  describe('normalizeEvent — payment_method callbacks', () => {
    function pmEvent(overrides: Record<string, unknown> = {}) {
      return {
        id: 'pm_1', type: 'CARD', reusability: 'MULTIPLE_USE', status: 'ACTIVE',
        reference_id: 'acepaysub_360e5be4-0087-41be-b418-0c4b808b975a',
        customer_id: 'xcus-1', updated: '2026-10-03T00:00:00Z',
        ...overrides,
      };
    }

    it('recognises a payment-method callback, not an invoice', () => {
      const n = adapter.normalizeEvent(pmEvent());
      expect(n.event).toBe('subscription.payment_method_linked');
      expect(n.acepaySubscriptionId).toBe('360e5be4-0087-41be-b418-0c4b808b975a');
      expect(n.providerSubscriptionId).toBe('pm_1');
    });

    it('recovers the subscription id from reference_id with no metadata present', () => {
      const e = pmEvent();
      expect('metadata' in e).toBe(false);
      expect(adapter.normalizeEvent(e).acepaySubscriptionId)
        .toBe('360e5be4-0087-41be-b418-0c4b808b975a');
    });

    it.each([
      ['FAILED', 'subscription.payment_method_failed'],
      ['EXPIRED', 'subscription.payment_method_failed'],
      ['REQUIRES_ACTION', 'subscription.payment_method_pending'],
      ['PENDING', 'subscription.payment_method_pending'],
    ])('maps status %s to %s', (status, expected) => {
      expect(adapter.normalizeEvent(pmEvent({ status })).event).toBe(expected);
    });

    it('leaves an unknown status unmapped', () => {
      expect(adapter.normalizeEvent(pmEvent({ status: 'SOMETHING_NEW' })).event).toBe('unknown');
    });

    it('builds a dedupable event id from the method and status', () => {
      expect(adapter.normalizeEvent(pmEvent()).providerEventId).toBe('xendit_pm_pm_1_active');
    });

    it('never reports a transaction id for a payment-method event', () => {
      const n = adapter.normalizeEvent(pmEvent());
      expect(n.acepayTxId).toBeNull();
      expect(n.providerTxId).toBeNull();
      expect(n.status).toBeNull();
    });

    it('does not mistake an invoice for a payment method', () => {
      const n = adapter.normalizeEvent({ id: 'inv_1', status: 'PAID', external_id: 'tx-1' });
      expect(n.event).toBe('payment.succeeded');
    });
  });

  describe('getOrCreateXenditCustomer', () => {
    const opts = { acepayCustomerRef: 'acepay_savi_sub-1', email: 'buyer@example.com', name: 'Buyer' };

    it('short-circuits on an already-known Xendit customer id', async () => {
      const id = await adapter.getOrCreateXenditCustomer({ ...opts, existingXenditCustomerId: 'xcus-known' });
      expect(id).toBe('xcus-known');
      expect(mockCustomer.getCustomerByReferenceID).not.toHaveBeenCalled();
      expect(mockCustomer.createCustomer).not.toHaveBeenCalled();
    });

    it('reuses a customer found by reference id', async () => {
      mockCustomer.getCustomerByReferenceID.mockResolvedValue({ data: [{ id: 'xcus-found' }] });
      await expect(adapter.getOrCreateXenditCustomer(opts)).resolves.toBe('xcus-found');
      expect(mockCustomer.createCustomer).not.toHaveBeenCalled();
    });

    it.each([
      ['the lookup throws', () => mockCustomer.getCustomerByReferenceID.mockRejectedValue(new Error('404'))],
      ['the lookup returns no rows', () => mockCustomer.getCustomerByReferenceID.mockResolvedValue({ data: [] })],
      ['the lookup returns a non-array', () => mockCustomer.getCustomerByReferenceID.mockResolvedValue({ data: null })],
      ['the lookup returns a row with no id', () => mockCustomer.getCustomerByReferenceID.mockResolvedValue({ data: [{}] })],
    ])('creates a customer when %s', async (_label, arrange) => {
      arrange();
      mockCustomer.createCustomer.mockResolvedValue({ id: 'xcus-new' });
      await expect(adapter.getOrCreateXenditCustomer(opts)).resolves.toBe('xcus-new');
      expect(mockCustomer.createCustomer).toHaveBeenCalled();
    });

    it('creates the customer against the AcePay reference id', async () => {
      mockCustomer.getCustomerByReferenceID.mockResolvedValue({ data: [] });
      mockCustomer.createCustomer.mockResolvedValue({ id: 'xcus-new' });
      await adapter.getOrCreateXenditCustomer(opts);
      expect(dataOf(mockCustomer.createCustomer)).toMatchObject({
        referenceId: 'acepay_savi_sub-1',
        email: 'buyer@example.com',
        type: 'INDIVIDUAL',
        individualDetail: { givenNames: 'Buyer' },
      });
    });

    it('falls back to the email local part when no name is known', async () => {
      mockCustomer.getCustomerByReferenceID.mockResolvedValue({ data: [] });
      mockCustomer.createCustomer.mockResolvedValue({ id: 'xcus-new' });
      await adapter.getOrCreateXenditCustomer({ ...opts, name: undefined });
      const detail = dataOf(mockCustomer.createCustomer).individualDetail as { givenNames: string };
      expect(detail.givenNames).toBe('buyer');
    });

    it('throws when the provider creates a customer with no id', async () => {
      mockCustomer.getCustomerByReferenceID.mockResolvedValue({ data: [] });
      mockCustomer.createCustomer.mockResolvedValue({});
      await expect(adapter.getOrCreateXenditCustomer(opts))
        .rejects.toThrow('Xendit createCustomer returned no id');
    });
  });

  describe('getPayment status mapping', () => {
    it.each([
      ['PAID', TransactionStatus.Succeeded],
      ['paid', TransactionStatus.Succeeded],
      ['EXPIRED', TransactionStatus.Failed],
      ['expired', TransactionStatus.Failed],
      ['PENDING', TransactionStatus.Pending],
      ['SETTLING', TransactionStatus.Pending],
      ['', TransactionStatus.Pending],
    ])('maps invoice status %s to %s', async (status, expected) => {
      mockInvoice.getInvoiceById.mockResolvedValue({ id: 'inv_1', status });
      const res = await adapter.getPayment('inv_1');
      expect(res.status).toBe(expected);
    });

    it('treats a missing status as pending', async () => {
      mockInvoice.getInvoiceById.mockResolvedValue({ id: 'inv_1' });
      await expect(adapter.getPayment('inv_1')).resolves.toMatchObject({
        status: TransactionStatus.Pending,
      });
    });

    it.each([
      ['snake_case paid_at', { paid_at: '2026-01-01T00:00:00Z' }],
      ['camelCase paidAt', { paidAt: '2026-01-01T00:00:00Z' }],
    ])('reads the completion time from %s', async (_label, extra) => {
      mockInvoice.getInvoiceById.mockResolvedValue({ id: 'inv_1', status: 'PAID', ...extra });
      const res = await adapter.getPayment('inv_1');
      expect(res.providerCompletedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('leaves the completion time null when the provider reports none', async () => {
      mockInvoice.getInvoiceById.mockResolvedValue({ id: 'inv_1', status: 'PAID' });
      await expect(adapter.getPayment('inv_1')).resolves.toMatchObject({ providerCompletedAt: null });
    });

    it('never reports a completion time for an expired invoice', async () => {
      mockInvoice.getInvoiceById.mockResolvedValue({
        id: 'inv_1', status: 'EXPIRED', paid_at: '2026-01-01T00:00:00Z',
      });
      await expect(adapter.getPayment('inv_1')).resolves.toMatchObject({ providerCompletedAt: null });
    });
  });

  describe('refund edge cases', () => {
    beforeEach(() => {
      mockInvoice.getInvoiceById.mockResolvedValue({ id: 'inv_1', paymentId: 'pay_1' });
      mockRefund.createRefund.mockResolvedValue({ id: 'rfd_1' });
    });

    it('sends no amount for a full refund', async () => {
      await adapter.refund('inv_1');
      expect(dataOf(mockRefund.createRefund).amount).toBeUndefined();
    });

    it('converts a partial refund amount to major units', async () => {
      await adapter.refund('inv_1', 5000);
      expect(dataOf(mockRefund.createRefund).amount).toBe(50);
    });

    it('treats a zero refund as an explicit zero, not a full refund', async () => {
      await adapter.refund('inv_1', 0);
      expect(dataOf(mockRefund.createRefund).amount).toBe(0);
    });

    it('always reports the refund as pending (Xendit settles asynchronously)', async () => {
      await expect(adapter.refund('inv_1', 5000)).resolves.toMatchObject({
        status: TransactionStatus.Pending,
        providerRefundId: 'rfd_1',
      });
    });

    it('tolerates a refund response with no id', async () => {
      mockRefund.createRefund.mockResolvedValue({});
      await expect(adapter.refund('inv_1', 5000)).resolves.toMatchObject({ providerRefundId: '' });
    });
  });

  describe('normalizeEvent edge cases', () => {
    function invoiceEvent(overrides: Record<string, unknown> = {}) {
      return { id: 'inv_1', status: 'PAID', ...overrides };
    }

    it('maps a PENDING invoice to payment.pending', () => {
      const n = adapter.normalizeEvent(invoiceEvent({ status: 'PENDING' }));
      expect(n.event).toBe('payment.pending');
      expect(n.status).toBe(TransactionStatus.Pending);
    });

    it.each([
      ['an unrecognized status', 'SETTLING'],
      ['an empty status', ''],
    ])('leaves the event unknown for %s', (_label, status) => {
      const n = adapter.normalizeEvent(invoiceEvent({ status }));
      expect(n.event).toBe('unknown');
      expect(n.status).toBeNull();
    });

    it('treats a missing status as unknown rather than guessing', () => {
      const n = adapter.normalizeEvent({ id: 'inv_1' });
      expect(n.event).toBe('unknown');
      expect(n.status).toBeNull();
    });

    it('accepts a lowercase provider status', () => {
      expect(adapter.normalizeEvent(invoiceEvent({ status: 'paid' })).event).toBe('payment.succeeded');
    });

    it('builds a dedupable provider event id from invoice + status', () => {
      expect(adapter.normalizeEvent(invoiceEvent()).providerEventId).toBe('xendit_invoice_inv_1_paid');
    });

    it('prefers metadata.acepay_tx over the external id', () => {
      const n = adapter.normalizeEvent(invoiceEvent({
        external_id: 'ext-1', metadata: { acepay_tx: 'tx-meta' },
      }));
      expect(n.acepayTxId).toBe('tx-meta');
    });

    it('falls back to the external id when metadata has no tx', () => {
      expect(adapter.normalizeEvent(invoiceEvent({ external_id: 'ext-1' })).acepayTxId).toBe('ext-1');
    });

    it('reports no AcePay tx when neither is present', () => {
      expect(adapter.normalizeEvent(invoiceEvent()).acepayTxId).toBeNull();
    });

    it.each([
      ['paid_at', { paid_at: '2026-03-01T00:00:00Z', created: '2026-01-01T00:00:00Z' }, '2026-03-01T00:00:00.000Z'],
      ['created when paid_at is absent', { created: '2026-01-01T00:00:00Z' }, '2026-01-01T00:00:00.000Z'],
    ])('takes occurredAt from %s', (_label, extra, expected) => {
      expect(adapter.normalizeEvent(invoiceEvent(extra)).occurredAt?.toISOString()).toBe(expected);
    });

    it('leaves occurredAt null when the invoice carries no timestamps', () => {
      expect(adapter.normalizeEvent(invoiceEvent()).occurredAt).toBeNull();
    });

    // A subscription first-payment is told apart purely by metadata, and the
    // invoice id doubles as the provisional subscription id.
    it('reports the invoice id as the subscription id for a first payment', () => {
      const n = adapter.normalizeEvent(invoiceEvent({ metadata: { acepay_subscription: 'sub-1' } }));
      expect(n.providerSubscriptionId).toBe('inv_1');
      expect(n.acepaySubscriptionId).toBe('sub-1');
    });

    it('reports no subscription id for a one-time payment', () => {
      expect(adapter.normalizeEvent(invoiceEvent()).providerSubscriptionId).toBeNull();
    });
  });

  // Captured verbatim from a real Xendit test-mode payment during UAT. The
  // synthetic payload the simulator builds DOES carry metadata, so it could
  // never have caught this: real invoice callbacks omit metadata entirely, and
  // subscription detection used to depend on it. The customer paid and the
  // gateway answered no_app_match.
  describe('a real Xendit paid-invoice callback (no metadata echoed)', () => {
    const REAL = {
      id: '6ac0394935f01caa61433b27',
      external_id: 'sub_360e5be4-0087-41be-b418-0c4b808b975a_cycle_1',
      user_id: '69a27e4e24dfbfbc50a84c72',
      credit_card_token: '6ac03b4d2acc7be09f823f9e',
      credit_card_charge_id: '6ac03b752acc7be09f823fb3',
      payment_method: 'CREDIT_CARD',
      status: 'PAID',
      merchant_name: 'Ace Dev',
      amount: 299,
      paid_amount: 299,
      paid_at: '2026-10-02T23:17:09.401Z',
      payer_email: 'you@example.com',
      description: 'uat-alpha subscription — first payment',
      currency: 'PHP',
      payment_channel: 'CREDIT_CARD',
    };

    it('recognises it as a subscription first payment with no metadata present', () => {
      expect('metadata' in REAL).toBe(false);
      const n = adapter.normalizeEvent(REAL);
      expect(n.acepaySubscriptionId).toBe('360e5be4-0087-41be-b418-0c4b808b975a');
      expect(n.event).toBe('subscription.created');
      expect(n.status).toBe(TransactionStatus.Succeeded);
    });

    it('does not mistake the subscription externalId for a transaction id', () => {
      // It is not a uuid, so using it as acepayTxId matches nothing and used to
      // route the whole event down the one-time payment path.
      expect(adapter.normalizeEvent(REAL).acepayTxId).toBeNull();
    });

    it('still reports the invoice id as the provider references', () => {
      const n = adapter.normalizeEvent(REAL);
      expect(n.providerTxId).toBe('6ac0394935f01caa61433b27');
      expect(n.providerSubscriptionId).toBe('6ac0394935f01caa61433b27');
      expect(n.occurredAt?.toISOString()).toBe('2026-10-02T23:17:09.401Z');
    });

    it('prefers metadata when the provider does echo it', () => {
      const n = adapter.normalizeEvent({
        ...REAL, metadata: { acepay_subscription: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
      });
      expect(n.acepaySubscriptionId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    });

    it.each([
      ['a one-time payment externalId (a bare uuid)', '3f8a1c2e-4b5d-6e7f-8a9b-0c1d2e3f4a5b'],
      ['an unrelated externalId', 'invoice_123124123'],
      ['a malformed cycle reference', 'sub_not-a-uuid_cycle_1'],
    ])('does not treat %s as a subscription', (_label, external_id) => {
      const n = adapter.normalizeEvent({ ...REAL, external_id });
      expect(n.acepaySubscriptionId).toBeNull();
      expect(n.event).toBe('payment.succeeded');
      expect(n.acepayTxId).toBe(external_id);
    });

    it('reads later cycles too', () => {
      const n = adapter.normalizeEvent({
        ...REAL, external_id: 'sub_360e5be4-0087-41be-b418-0c4b808b975a_cycle_7',
      });
      expect(n.acepaySubscriptionId).toBe('360e5be4-0087-41be-b418-0c4b808b975a');
    });
  });

  describe('verifyWebhook edge cases', () => {
    it('rejects an empty token as missing', () => {
      expect(() => adapter.verifyWebhook(Buffer.from('{}'), ''))
        .toThrow('Missing x-callback-token header');
    });

    it('propagates a malformed JSON body', () => {
      expect(() => adapter.verifyWebhook(Buffer.from('{not json'), WEBHOOK_TOKEN)).toThrow();
    });

    it('accepts an empty JSON object body', () => {
      expect(adapter.verifyWebhook(Buffer.from('{}'), WEBHOOK_TOKEN)).toEqual({});
    });

    it('is case-sensitive on the token', () => {
      expect(() => adapter.verifyWebhook(Buffer.from('{}'), WEBHOOK_TOKEN.toUpperCase()))
        .toThrow('Invalid Xendit webhook token');
    });
  });

  describe('cancel / uncancel (AcePay-managed, no provider call)', () => {
    it('cancelSubscription reports canceled with both timestamps set', async () => {
      const r = await adapter.cancelSubscription('sub_1');
      expect(String(r.status)).toBe('canceled');
      expect(r.cancelAt).toBeInstanceOf(Date);
      expect(r.canceledAt).toBeInstanceOf(Date);
      expect(mockInvoice.createInvoice).not.toHaveBeenCalled();
    });

    it('uncancelSubscription reports active and clears the cancel timestamps', async () => {
      const r = await adapter.uncancelSubscription('sub_1');
      expect(String(r.status)).toBe('active');
      expect(r.cancelAt).toBeNull();
      expect(r.canceledAt).toBeNull();
    });

    it('getSubscription returns an AcePay-managed stub', async () => {
      const r = await adapter.getSubscription('sub_1');
      expect(String(r.status)).toBe('active');
      expect(r.raw).toEqual({ note: 'xendit_subscription_managed_by_acepay' });
    });
  });

  describe('metadata stringification', () => {
    beforeEach(() => mockInvoice.createInvoice.mockResolvedValue(invoiceOk()));

    // Xendit metadata values must be strings, so non-strings are JSON-encoded
    // and nullish entries dropped entirely.
    it('JSON-encodes non-string values and drops nullish ones', async () => {
      await adapter.createPayment(paymentParams({
        metadata: {
          count: 3, flag: true, nested: { a: 1 }, list: [1, 2],
          missing: null, absent: undefined, kept: 'plain',
        },
      }));
      const md = dataOf(mockInvoice.createInvoice).metadata as Record<string, string>;
      expect(md).toMatchObject({
        count: '3', flag: 'true', nested: '{"a":1}', list: '[1,2]', kept: 'plain',
      });
      expect(md).not.toHaveProperty('missing');
      expect(md).not.toHaveProperty('absent');
    });

    it('preserves a zero and an empty string', async () => {
      await adapter.createPayment(paymentParams({ metadata: { zero: 0, blank: '' } }));
      const md = dataOf(mockInvoice.createInvoice).metadata as Record<string, string>;
      expect(md.zero).toBe('0');
      expect(md.blank).toBe('');
    });
  });
});
