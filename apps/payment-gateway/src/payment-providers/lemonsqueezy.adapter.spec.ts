import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus, TransactionStatus } from '../common/enums';

// Mock the Lemon Squeezy SDK — the adapter imports named functions from it.
jest.mock('@lemonsqueezy/lemonsqueezy.js', () => ({
  lemonSqueezySetup: jest.fn(),
  createCheckout: jest.fn(),
  getCheckout: jest.fn(),
  getOrder: jest.fn(),
  getProduct: jest.fn(),
  getStore: jest.fn(),
  getSubscription: jest.fn(),
  getVariant: jest.fn(),
  issueOrderRefund: jest.fn(),
  cancelSubscription: jest.fn(),
  updateSubscription: jest.fn(),
}));

import {
  cancelSubscription,
  createCheckout,
  getCheckout,
  getOrder,
  getProduct,
  getStore,
  getSubscription,
  getVariant,
  issueOrderRefund,
  updateSubscription,
} from '@lemonsqueezy/lemonsqueezy.js';
import { LemonsqueezyAdapter } from './lemonsqueezy.adapter';

const WEBHOOK_SECRET = 'ls_whsec_test';

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const env: Record<string, string> = {
    LEMONSQUEEZY_API_KEY: 'ls_key',
    LEMONSQUEEZY_STORE_ID: '111',
    LEMONSQUEEZY_VARIANT_ID: '222',
    LEMONSQUEEZY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    LEMONSQUEEZY_TEST_MODE: 'true',
    ...overrides,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService;
}

function sign(body: Buffer, secret = WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('LemonsqueezyAdapter', () => {
  let adapter: LemonsqueezyAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new LemonsqueezyAdapter(makeConfig());
  });

  describe('verifyWebhook (A3)', () => {
    it('accepts a correctly-signed body and returns the parsed payload', () => {
      const body = Buffer.from(JSON.stringify({ meta: { event_name: 'order_created' }, data: {} }));
      const result = adapter.verifyWebhook(body, sign(body)) as { meta: { event_name: string } };
      expect(result.meta.event_name).toBe('order_created');
    });

    it('rejects when a single byte of the body is tampered', () => {
      const body = Buffer.from(JSON.stringify({ meta: { event_name: 'order_created' }, data: {} }));
      const goodSig = sign(body);
      const tampered = Buffer.from(body);
      tampered[10] ^= 0xff;
      expect(() => adapter.verifyWebhook(tampered, goodSig)).toThrow(/Invalid Lemon Squeezy webhook signature/);
    });

    it('rejects a signature made with the wrong secret', () => {
      const body = Buffer.from('{}');
      expect(() => adapter.verifyWebhook(body, sign(body, 'wrong-secret'))).toThrow(/Invalid/);
    });

    it('throws when the signature header is missing', () => {
      expect(() => adapter.verifyWebhook(Buffer.from('{}'), undefined)).toThrow(/Missing X-Signature/);
    });

    it('is case-insensitive on the hex signature', () => {
      const body = Buffer.from('{"meta":{"event_name":"order_created"},"data":{}}');
      expect(() => adapter.verifyWebhook(body, sign(body).toUpperCase())).not.toThrow();
    });
  });

  describe('normalizeEvent (A3/A5)', () => {
    it('maps a paid order_created to payment.succeeded and carries custom metadata', () => {
      const ev = {
        meta: { event_name: 'order_created', custom_data: { acepay_tx: 'tx_1', acepay_subscription: 'sub_1' } },
        data: { type: 'orders', id: '9001', attributes: { status: 'paid', created_at: '2026-01-01T00:00:00Z' } },
      };
      const n = adapter.normalizeEvent(ev);
      expect(n.event).toBe('payment.succeeded');
      expect(n.status).toBe(TransactionStatus.Succeeded);
      expect(n.providerTxId).toBe('9001'); // numeric order id, not a checkout UUID
      expect(n.acepayTxId).toBe('tx_1');
      expect(n.providerEventId).toBe('order_created_9001');
    });

    it('maps a failed order to payment.failed', () => {
      const n = adapter.normalizeEvent({
        meta: { event_name: 'order_created' },
        data: { type: 'orders', id: '1', attributes: { status: 'failed' } },
      });
      expect(n.event).toBe('payment.failed');
      expect(n.status).toBe(TransactionStatus.Failed);
    });

    it('maps subscription_created and exposes the subscription id from data.id (A5)', () => {
      const n = adapter.normalizeEvent({
        meta: { event_name: 'subscription_created', custom_data: { acepay_subscription: 'sub_42' } },
        data: { type: 'subscriptions', id: 'ls_sub_777', attributes: { status: 'active' } },
      });
      expect(n.event).toBe('subscription.created');
      expect(n.subscriptionStatus).toBe(SubscriptionStatus.Active);
      expect(n.providerSubscriptionId).toBe('ls_sub_777');
      expect(n.acepaySubscriptionId).toBe('sub_42');
    });

    it('marks the subscription past_due on a failed subscription payment', () => {
      const n = adapter.normalizeEvent({
        meta: { event_name: 'subscription_payment_failed' },
        data: { type: 'subscription-invoices', id: 'inv_1', attributes: { subscription_id: 'ls_sub_9' } },
      });
      expect(n.event).toBe('subscription.payment_failed');
      expect(n.status).toBe(TransactionStatus.Failed);
      expect(n.subscriptionStatus).toBe(SubscriptionStatus.PastDue);
      // subscription-invoices resolve the sub id from attributes.subscription_id.
      expect(n.providerSubscriptionId).toBe('ls_sub_9');
    });

    it('recovers a subscription to active on payment_recovered', () => {
      const n = adapter.normalizeEvent({
        meta: { event_name: 'subscription_payment_recovered' },
        data: { type: 'subscription-invoices', id: 'inv_2', attributes: { subscription_id: 'ls_sub_9' } },
      });
      expect(n.subscriptionStatus).toBe(SubscriptionStatus.Active);
      expect(n.status).toBe(TransactionStatus.Succeeded);
    });
  });

  describe('refund (A7)', () => {
    it('refuses to refund a checkout UUID (no order created yet)', async () => {
      await expect(
        adapter.refund('123e4567-e89b-12d3-a456-426614174000', 1000),
      ).rejects.toThrow(/no order has been created/);
    });

    it('requires an explicit amount (no full-refund sentinel)', async () => {
      await expect(adapter.refund('9001')).rejects.toThrow(/require an amount/);
    });

    it('passes the exact amount to issueOrderRefund for a numeric order id', async () => {
      (issueOrderRefund as jest.Mock).mockResolvedValue({ data: { data: { id: 'refund_1' } }, error: null });
      const res = await adapter.refund('9001', 29900);
      expect(issueOrderRefund).toHaveBeenCalledWith('9001', 29900);
      expect(res.providerRefundId).toBe('refund_1');
      expect(res.status).toBe(TransactionStatus.Refunded);
    });

    it('surfaces a provider error', async () => {
      (issueOrderRefund as jest.Mock).mockResolvedValue({ data: null, error: { message: 'boom' } });
      await expect(adapter.refund('9001', 100)).rejects.toThrow(/refund failed: boom/);
    });
  });

  describe('getPayment id-shape routing (A5)', () => {
    it('fetches an order when the providerTxId is numeric', async () => {
      (getOrder as jest.Mock).mockResolvedValue({
        data: { data: { id: '9001', attributes: { status: 'paid', created_at: '2026-01-01T00:00:00Z' } } },
        error: null,
      });
      const res = await adapter.getPayment('9001');
      expect(getOrder).toHaveBeenCalledWith('9001');
      expect(res.status).toBe(TransactionStatus.Succeeded);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Edge cases below: minor-unit pricing, test-mode gating, checkout-vs-order
  // id routing, the subscription lifecycle payloads and variant lookup.
  // ─────────────────────────────────────────────────────────────────────

  /** A successful createCheckout response. */
  function checkoutOk(overrides: Record<string, unknown> = {}) {
    return {
      data: {
        data: {
          id: 'chk-uuid',
          attributes: { url: 'https://store.lemonsqueezy.com/checkout/chk-uuid', ...overrides },
        },
      },
      error: null,
    };
  }

  function paymentParams(overrides: Record<string, unknown> = {}) {
    return {
      acepayTxId: 'tx-1',
      appSlug: 'savi',
      amount: 29900,
      currency: 'USD',
      redirect: { success: 'https://savi.app/ok', failed: 'https://savi.app/no' },
      ...overrides,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  function subscriptionParams(overrides: Record<string, unknown> = {}) {
    return {
      acepaySubscriptionId: 'sub-1',
      appSlug: 'savi',
      providerPlanId: '777',
      customer: { email: 'buyer@example.com', name: 'Buyer' },
      redirect: { success: 'https://savi.app/ok', failed: 'https://savi.app/no' },
      metadata: {},
      ...overrides,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  describe('env wiring', () => {
    it.each([
      ['LEMONSQUEEZY_API_KEY', 'LEMONSQUEEZY_API_KEY env var is not set'],
      ['LEMONSQUEEZY_STORE_ID', 'LEMONSQUEEZY_STORE_ID env var is not set'],
    ])('throws a named error when %s is missing', async (key, message) => {
      const a = new LemonsqueezyAdapter(makeConfig({ [key]: undefined as unknown as string }));
      await expect(a.createPayment(paymentParams())).rejects.toThrow(message);
    });

    it('explains how to fix a missing LEMONSQUEEZY_VARIANT_ID', async () => {
      const a = new LemonsqueezyAdapter(makeConfig({ LEMONSQUEEZY_VARIANT_ID: undefined as unknown as string }));
      await expect(a.createPayment(paymentParams()))
        .rejects.toThrow(/LEMONSQUEEZY_VARIANT_ID env var is not set.*Generic Charge/s);
    });

    it('throws when the webhook secret is missing', () => {
      const a = new LemonsqueezyAdapter(makeConfig({ LEMONSQUEEZY_WEBHOOK_SECRET: undefined as unknown as string }));
      expect(() => a.verifyWebhook(Buffer.from('{}'), 'deadbeef'))
        .toThrow('LEMONSQUEEZY_WEBHOOK_SECRET env var is not set');
    });
  });

  describe('test mode gating', () => {
    async function testModeFor(value: string | undefined): Promise<boolean> {
      (createCheckout as jest.Mock).mockResolvedValue(checkoutOk());
      const a = new LemonsqueezyAdapter(makeConfig({ LEMONSQUEEZY_TEST_MODE: value as string }));
      await a.createPayment(paymentParams());
      const opts = (createCheckout as jest.Mock).mock.calls.at(-1)?.[2] as { testMode: boolean };
      return opts.testMode;
    }

    // Test mode is opt-OUT: only the exact string 'false' turns it off, so a
    // deploy that forgets the var stays safely in the sandbox.
    it.each([
      ['undefined', undefined, true],
      ['true', 'true', true],
      ['an empty string', '', true],
      ['0', '0', true],
    ])('stays in test mode when the flag is %s', async (_label, value, expected) => {
      await expect(testModeFor(value)).resolves.toBe(expected);
    });

    it('goes live only for the exact string "false"', async () => {
      await expect(testModeFor('false')).resolves.toBe(false);
    });

    // The flip side of opt-out: 'FALSE' does NOT go live. Worth pinning so the
    // asymmetry is a decision rather than a surprise during a launch.
    it.each(['FALSE', 'False', ' false'])('does not go live for %j', async (value) => {
      await expect(testModeFor(value)).resolves.toBe(true);
    });
  });

  describe('createPayment — customPrice in MINOR units', () => {
    beforeEach(() => (createCheckout as jest.Mock).mockResolvedValue(checkoutOk()));

    // The opposite convention from Xendit: Lemon Squeezy's customPrice is in
    // cents, so the amount passes through undivided. Dividing here would
    // undercharge by 100x.
    it.each([29900, 49900, 1, 100, 49999])('passes minor amount %i through unchanged', async (amount) => {
      await adapter.createPayment(paymentParams({ amount }));
      const opts = (createCheckout as jest.Mock).mock.calls[0][2] as { customPrice: number };
      expect(opts.customPrice).toBe(amount);
    });

    it('charges against the store and the generic-charge variant', async () => {
      await adapter.createPayment(paymentParams());
      const [storeId, variantId] = (createCheckout as jest.Mock).mock.calls[0];
      expect(storeId).toBe('111');
      expect(variantId).toBe('222');
    });

    it('tags the checkout with the AcePay tx and app slug', async () => {
      await adapter.createPayment(paymentParams({ metadata: { userId: 'u1' } }));
      const opts = (createCheckout as jest.Mock).mock.calls[0][2] as {
        checkoutData: { custom: Record<string, string> };
      };
      expect(opts.checkoutData.custom).toMatchObject({
        acepay_tx: 'tx-1', app_slug: 'savi', userId: 'u1',
      });
    });

    it('falls back to a generated product name', async () => {
      await adapter.createPayment(paymentParams({ description: undefined }));
      const opts = (createCheckout as jest.Mock).mock.calls[0][2] as {
        productOptions: { name: string; description?: string };
      };
      expect(opts.productOptions.name).toBe('Payment for savi');
      expect(opts.productOptions.description).toBeUndefined();
    });

    it('returns the checkout id and URL', async () => {
      const res = await adapter.createPayment(paymentParams());
      expect(res.providerTxId).toBe('chk-uuid');
      expect(res.checkoutUrl).toBe('https://store.lemonsqueezy.com/checkout/chk-uuid');
    });

    it('uses the provider created timestamp when present', async () => {
      (createCheckout as jest.Mock).mockResolvedValue(
        checkoutOk({ created_at: '2026-04-05T06:07:08Z' }),
      );
      const res = await adapter.createPayment(paymentParams());
      expect(res.providerCreatedAt.toISOString()).toBe('2026-04-05T06:07:08.000Z');
    });

    it.each([
      ['the SDK reports an error', { data: null, error: { message: 'rate limited' } }],
      ['the SDK returns no data', { data: null, error: null }],
    ])('throws when %s', async (_label, resp) => {
      (createCheckout as jest.Mock).mockResolvedValue(resp);
      await expect(adapter.createPayment(paymentParams()))
        .rejects.toThrow(/createCheckout failed/);
    });

    it('throws when the checkout has no URL', async () => {
      (createCheckout as jest.Mock).mockResolvedValue(checkoutOk({ url: undefined }));
      await expect(adapter.createPayment(paymentParams()))
        .rejects.toThrow('Lemon Squeezy did not return a checkout URL');
    });
  });

  describe('createSubscription — priced by the variant, not by us', () => {
    beforeEach(() => (createCheckout as jest.Mock).mockResolvedValue(checkoutOk()));

    it("uses the plan's own variant id, not the generic-charge variant", async () => {
      await adapter.createSubscription(subscriptionParams());
      const [storeId, variantId] = (createCheckout as jest.Mock).mock.calls[0];
      expect(storeId).toBe('111');
      expect(variantId).toBe('777');
    });

    // A recurring variant carries its own price; sending customPrice would
    // override the subscription pricing set up in the store.
    it('never sends a customPrice override', async () => {
      await adapter.createSubscription(subscriptionParams());
      const opts = (createCheckout as jest.Mock).mock.calls[0][2] as Record<string, unknown>;
      expect(opts).not.toHaveProperty('customPrice');
    });

    it('tags the checkout with the AcePay subscription id', async () => {
      await adapter.createSubscription(subscriptionParams({ metadata: { tier: 'pro' } }));
      const opts = (createCheckout as jest.Mock).mock.calls[0][2] as {
        checkoutData: { custom: Record<string, string> };
      };
      expect(opts.checkoutData.custom).toMatchObject({
        acepay_subscription: 'sub-1', app_slug: 'savi', tier: 'pro',
      });
    });

    it('returns the checkout id as the provider checkout id', async () => {
      const res = await adapter.createSubscription(subscriptionParams());
      expect(res.providerCheckoutId).toBe('chk-uuid');
    });

    it('surfaces a provider error', async () => {
      (createCheckout as jest.Mock).mockResolvedValue({ data: null, error: { message: 'variant not found' } });
      await expect(adapter.createSubscription(subscriptionParams()))
        .rejects.toThrow('createCheckout (subscription) failed: variant not found');
    });

    it('throws when the checkout has no URL', async () => {
      (createCheckout as jest.Mock).mockResolvedValue(checkoutOk({ url: undefined }));
      await expect(adapter.createSubscription(subscriptionParams()))
        .rejects.toThrow('Lemon Squeezy did not return a checkout URL');
    });
  });

  // The stored providerTxId starts life as a checkout UUID and is swapped to a
  // numeric order id when order_created arrives. getPayment has to work in both
  // states, and must not ask for an order using a UUID.
  describe('getPayment — checkout UUID vs numeric order id', () => {
    const UUID = '3f8a1c2e-4b5d-6e7f-8a9b-0c1d2e3f4a5b';

    it('goes straight to the checkout for a UUID, never touching getOrder', async () => {
      (getCheckout as jest.Mock).mockResolvedValue({
        data: { data: { id: UUID, attributes: {} } }, error: null,
      });
      const res = await adapter.getPayment(UUID);
      expect(getOrder).not.toHaveBeenCalled();
      expect(getCheckout).toHaveBeenCalledWith(UUID);
      // A checkout that has not converted yet is still pending by definition.
      expect(res.status).toBe(TransactionStatus.Pending);
      expect(res.providerCompletedAt).toBeNull();
    });

    it('recognizes an uppercase UUID as a checkout id', async () => {
      (getCheckout as jest.Mock).mockResolvedValue({
        data: { data: { id: UUID, attributes: {} } }, error: null,
      });
      await adapter.getPayment(UUID.toUpperCase());
      expect(getOrder).not.toHaveBeenCalled();
    });

    it.each([
      ['paid', TransactionStatus.Succeeded],
      ['refunded', TransactionStatus.Refunded],
      ['failed', TransactionStatus.Failed],
      ['pending', TransactionStatus.Pending],
      ['something_new', TransactionStatus.Pending],
    ])('maps order status %s to %s', async (status, expected) => {
      (getOrder as jest.Mock).mockResolvedValue({
        data: { data: { id: '9001', attributes: { status } } }, error: null,
      });
      await expect(adapter.getPayment('9001')).resolves.toMatchObject({ status: expected });
    });

    it('dates a paid order from created_at', async () => {
      (getOrder as jest.Mock).mockResolvedValue({
        data: { data: { id: '9001', attributes: { status: 'paid', created_at: '2026-01-01T00:00:00Z' } } },
        error: null,
      });
      const res = await adapter.getPayment('9001');
      expect(res.providerCompletedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('dates a refunded order from refunded_at, not created_at', async () => {
      (getOrder as jest.Mock).mockResolvedValue({
        data: {
          data: {
            id: '9001',
            attributes: {
              status: 'refunded',
              created_at: '2026-01-01T00:00:00Z',
              refunded_at: '2026-02-02T00:00:00Z',
            },
          },
        },
        error: null,
      });
      const res = await adapter.getPayment('9001');
      expect(res.providerCompletedAt?.toISOString()).toBe('2026-02-02T00:00:00.000Z');
    });

    it('treats an order with no status as pending', async () => {
      (getOrder as jest.Mock).mockResolvedValue({
        data: { data: { id: '9001', attributes: {} } }, error: null,
      });
      await expect(adapter.getPayment('9001')).resolves.toMatchObject({
        status: TransactionStatus.Pending,
      });
    });

    // A non-UUID id that isn't a known order falls back to a checkout lookup
    // rather than failing outright.
    it('falls back to the checkout when the order lookup fails', async () => {
      (getOrder as jest.Mock).mockResolvedValue({ data: null, error: { message: 'not found' } });
      (getCheckout as jest.Mock).mockResolvedValue({
        data: { data: { id: 'not-a-uuid', attributes: {} } }, error: null,
      });
      const res = await adapter.getPayment('not-a-uuid');
      expect(getOrder).toHaveBeenCalled();
      expect(getCheckout).toHaveBeenCalledWith('not-a-uuid');
      expect(res.status).toBe(TransactionStatus.Pending);
    });

    it('throws a diagnostic error when neither lookup succeeds', async () => {
      (getOrder as jest.Mock).mockResolvedValue({ data: null, error: { message: 'no order' } });
      (getCheckout as jest.Mock).mockResolvedValue({ data: null, error: { message: 'no checkout' } });
      await expect(adapter.getPayment('9001'))
        .rejects.toThrow('Lemon Squeezy: cannot fetch 9001: no checkout');
    });

    it('reports "not found" when the SDK returns neither data nor an error', async () => {
      (getOrder as jest.Mock).mockResolvedValue({ data: null, error: null });
      (getCheckout as jest.Mock).mockResolvedValue({ data: null, error: null });
      await expect(adapter.getPayment('9001')).rejects.toThrow(/cannot fetch 9001: not found/);
    });
  });

  describe('refund edge cases', () => {
    it('treats a zero amount as an explicit zero refund, not a missing one', async () => {
      (issueOrderRefund as jest.Mock).mockResolvedValue({ data: { data: { id: 'rf_1' } }, error: null });
      await adapter.refund('9001', 0);
      expect(issueOrderRefund).toHaveBeenCalledWith('9001', 0);
    });

    it('reports the refund as already refunded (LS settles synchronously)', async () => {
      (issueOrderRefund as jest.Mock).mockResolvedValue({ data: { data: { id: 'rf_1' } }, error: null });
      await expect(adapter.refund('9001', 29900)).resolves.toMatchObject({
        providerRefundId: 'rf_1',
        status: TransactionStatus.Refunded,
      });
    });
  });

  describe('subscription lifecycle payloads', () => {
    const subResponse = {
      data: {
        data: {
          id: '555',
          attributes: {
            status: 'active',
            created_at: '2026-01-01T00:00:00Z',
            renews_at: '2026-02-01T00:00:00Z',
            ends_at: null,
          },
        },
      },
      error: null,
    };

    beforeEach(() => {
      (getSubscription as jest.Mock).mockResolvedValue(subResponse);
      (cancelSubscription as jest.Mock).mockResolvedValue(subResponse);
      (updateSubscription as jest.Mock).mockResolvedValue(subResponse);
    });

    // These three payload shapes are the whole LS pause/resume/uncancel contract.
    it('pauses with a void-mode pause', async () => {
      await adapter.pauseSubscription('555');
      expect(updateSubscription).toHaveBeenCalledWith('555', { pause: { mode: 'void' } });
    });

    it('resumes by clearing the pause', async () => {
      await adapter.resumeSubscription('555');
      expect(updateSubscription).toHaveBeenCalledWith('555', { pause: null });
    });

    it('uncancels by clearing the cancelled flag', async () => {
      await adapter.uncancelSubscription('555');
      expect(updateSubscription).toHaveBeenCalledWith('555', { cancelled: false });
    });

    it('cancels through the dedicated endpoint', async () => {
      await adapter.cancelSubscription('555');
      expect(cancelSubscription).toHaveBeenCalledWith('555');
    });

    it('maps the period window onto the AcePay shape', async () => {
      const r = await adapter.getSubscription('555');
      expect(r.providerSubscriptionId).toBe('555');
      expect(r.currentPeriodStart?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(r.currentPeriodEnd?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
      expect(r.cancelAt).toBeNull();
      expect(r.canceledAt).toBeNull();
    });

    it.each([
      ['active', SubscriptionStatus.Active],
      ['on_trial', SubscriptionStatus.Active],
      ['paused', SubscriptionStatus.Paused],
      ['past_due', SubscriptionStatus.PastDue],
      ['unpaid', SubscriptionStatus.PastDue],
      ['cancelled', SubscriptionStatus.Canceled],
      ['expired', SubscriptionStatus.Expired],
      ['something_new', SubscriptionStatus.Active],
    ])('maps provider status %s to %s', async (status, expected) => {
      (getSubscription as jest.Mock).mockResolvedValue({
        data: { data: { id: '555', attributes: { status } } }, error: null,
      });
      await expect(adapter.getSubscription('555')).resolves.toMatchObject({ status: expected });
    });

    // ends_at alone is a scheduled end; only `cancelled` makes it a cancellation.
    it('reports a scheduled end without claiming it was cancelled', async () => {
      (getSubscription as jest.Mock).mockResolvedValue({
        data: { data: { id: '555', attributes: { status: 'active', ends_at: '2026-03-01T00:00:00Z' } } },
        error: null,
      });
      const r = await adapter.getSubscription('555');
      expect(r.cancelAt?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
      expect(r.canceledAt).toBeNull();
    });

    it('reports canceledAt once the subscription is flagged cancelled', async () => {
      (getSubscription as jest.Mock).mockResolvedValue({
        data: {
          data: {
            id: '555',
            attributes: { status: 'cancelled', cancelled: true, ends_at: '2026-03-01T00:00:00Z' },
          },
        },
        error: null,
      });
      const r = await adapter.getSubscription('555');
      expect(r.canceledAt?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    });

    it.each([
      ['getSubscription', () => adapter.getSubscription('555'), getSubscription, 'getSubscription failed'],
      ['cancelSubscription', () => adapter.cancelSubscription('555'), cancelSubscription, 'cancelSubscription failed'],
      ['pauseSubscription', () => adapter.pauseSubscription('555'), updateSubscription, 'pauseSubscription failed'],
      ['resumeSubscription', () => adapter.resumeSubscription('555'), updateSubscription, 'resumeSubscription failed'],
      ['uncancelSubscription', () => adapter.uncancelSubscription('555'), updateSubscription, 'uncancelSubscription failed'],
    ])('%s surfaces a provider error', async (_label, call, mock, message) => {
      (mock as unknown as jest.Mock).mockResolvedValue({ data: null, error: { message: 'boom' } });
      await expect(call()).rejects.toThrow(`${message}: boom`);
    });
  });

  describe('lookupVariant (operator UX)', () => {
    function variantResponse(attrs: Record<string, unknown> = {}) {
      return {
        data: {
          data: {
            id: '777',
            attributes: {
              product_id: 42,
              name: 'Pro Monthly',
              slug: 'pro-monthly',
              price: 49900,
              is_subscription: true,
              interval: 'month',
              interval_count: 1,
              test_mode: true,
              ...attrs,
            },
          },
        },
        error: null,
      };
    }

    beforeEach(() => {
      (getVariant as jest.Mock).mockResolvedValue(variantResponse());
      (getProduct as jest.Mock).mockResolvedValue({
        data: { data: { attributes: { name: 'AcePay Pro', store_id: 111 } } }, error: null,
      });
      (getStore as jest.Mock).mockResolvedValue({
        data: { data: { attributes: { currency: 'php' } } }, error: null,
      });
    });

    it('normalizes the variant, product and store into one shape', async () => {
      await expect(adapter.lookupVariant('777')).resolves.toEqual({
        variantId: '777',
        productId: '42',
        productName: 'AcePay Pro',
        name: 'Pro Monthly',
        slug: 'pro-monthly',
        price: 49900,
        currency: 'PHP',
        isSubscription: true,
        interval: 'monthly',
        intervalCount: 1,
        testMode: true,
      });
    });

    it('throws a diagnostic error when the variant is unknown', async () => {
      (getVariant as jest.Mock).mockResolvedValue({ data: null, error: { message: 'no such variant' } });
      await expect(adapter.lookupVariant('bogus'))
        .rejects.toThrow('Lemon Squeezy: variant bogus not found: no such variant');
    });

    it.each([
      ['week', 'weekly'],
      ['month', 'monthly'],
      ['year', 'yearly'],
    ])('maps the %s interval to %s', async (ls, expected) => {
      (getVariant as jest.Mock).mockResolvedValue(variantResponse({ interval: ls }));
      await expect(adapter.lookupVariant('777')).resolves.toMatchObject({ interval: expected });
    });

    it.each([
      ['an unknown interval', 'fortnight'],
      ['no interval (a one-time variant)', undefined],
    ])('reports no interval for %s', async (_label, interval) => {
      (getVariant as jest.Mock).mockResolvedValue(variantResponse({ interval }));
      await expect(adapter.lookupVariant('777')).resolves.toMatchObject({ interval: null });
    });

    it('applies safe defaults for a sparse variant', async () => {
      (getVariant as jest.Mock).mockResolvedValue({
        data: { data: { id: '777', attributes: {} } }, error: null,
      });
      await expect(adapter.lookupVariant('777')).resolves.toMatchObject({
        productId: '', productName: '', name: '', slug: '',
        price: 0, intervalCount: 1, isSubscription: false, testMode: false, currency: '',
      });
    });

    it('skips the product and store lookups when there is no product id', async () => {
      (getVariant as jest.Mock).mockResolvedValue(variantResponse({ product_id: undefined }));
      const r = await adapter.lookupVariant('777');
      expect(getProduct).not.toHaveBeenCalled();
      expect(getStore).not.toHaveBeenCalled();
      expect(r.currency).toBe('');
    });

    // store_id can arrive in attributes OR under relationships, depending on
    // the endpoint — currency resolution must handle both.
    it('finds the store id under relationships when attributes omit it', async () => {
      (getProduct as jest.Mock).mockResolvedValue({
        data: {
          data: {
            attributes: { name: 'AcePay Pro' },
            relationships: { store: { data: { id: 111 } } },
          },
        },
        error: null,
      });
      await expect(adapter.lookupVariant('777')).resolves.toMatchObject({ currency: 'PHP' });
      expect(getStore).toHaveBeenCalledWith('111');
    });

    it('reports no currency when the store cannot be identified', async () => {
      (getProduct as jest.Mock).mockResolvedValue({
        data: { data: { attributes: { name: 'AcePay Pro' } } }, error: null,
      });
      const r = await adapter.lookupVariant('777');
      expect(r.currency).toBe('');
      expect(getStore).not.toHaveBeenCalled();
    });

    it('caches the store currency across lookups', async () => {
      await adapter.lookupVariant('777');
      await adapter.lookupVariant('777');
      expect(getStore).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['the store lookup throws', () => (getStore as jest.Mock).mockRejectedValue(new Error('500'))],
      ['the store returns no data', () => (getStore as jest.Mock).mockResolvedValue({ data: null, error: { message: 'x' } })],
      ['the store reports no currency', () => (getStore as jest.Mock).mockResolvedValue({ data: { data: { attributes: {} } }, error: null })],
    ])('degrades to an empty currency when %s', async (_label, arrange) => {
      arrange();
      // The variant is still usable — currency is the only thing lost.
      await expect(adapter.lookupVariant('777')).resolves.toMatchObject({ currency: '', price: 49900 });
    });

    it('does not cache an empty currency', async () => {
      (getStore as jest.Mock).mockResolvedValueOnce({ data: { data: { attributes: {} } }, error: null });
      await adapter.lookupVariant('777');
      (getStore as jest.Mock).mockResolvedValue({ data: { data: { attributes: { currency: 'usd' } } }, error: null });
      await expect(adapter.lookupVariant('777')).resolves.toMatchObject({ currency: 'USD' });
    });
  });

  describe('normalizeEvent edge cases', () => {
    function event(eventName: string, data: Record<string, unknown>, custom?: Record<string, string>) {
      return { meta: { event_name: eventName, custom_data: custom }, data };
    }

    it.each([
      ['pending', 'payment.pending', TransactionStatus.Pending],
      ['refunded', 'refund.succeeded', TransactionStatus.Refunded],
      ['something_new', 'payment.pending', TransactionStatus.Pending],
    ])('maps an order_created with status %s to %s', (status, expected, txStatus) => {
      const n = adapter.normalizeEvent(event('order_created', {
        type: 'orders', id: '9001', attributes: { status },
      }));
      expect(n.event).toBe(expected);
      expect(n.status).toBe(txStatus);
    });

    it('treats an order_created with no status as pending', () => {
      const n = adapter.normalizeEvent(event('order_created', {
        type: 'orders', id: '9001', attributes: {},
      }));
      expect(n.event).toBe('payment.pending');
    });

    it.each([
      ['order_refunded', 'refund.succeeded'],
      ['subscription_updated', 'subscription.updated'],
      ['subscription_cancelled', 'subscription.canceled'],
      ['subscription_resumed', 'subscription.resumed'],
      ['subscription_paused', 'subscription.paused'],
      ['subscription_expired', 'subscription.expired'],
      ['subscription_payment_success', 'subscription.payment_succeeded'],
      ['subscription_payment_refunded', 'refund.succeeded'],
    ])('maps %s to %s', (eventName, expected) => {
      const n = adapter.normalizeEvent(event(eventName, {
        type: 'subscriptions', id: '555', attributes: { status: 'active' },
      }));
      expect(n.event).toBe(expected);
    });

    it.each([
      ['subscription_cancelled', SubscriptionStatus.Canceled],
      ['subscription_paused', SubscriptionStatus.Paused],
      ['subscription_expired', SubscriptionStatus.Expired],
      ['subscription_resumed', SubscriptionStatus.Active],
    ])('forces the subscription status for %s regardless of the payload', (eventName, expected) => {
      // These events carry an authoritative meaning, so a stale attributes.status
      // in the payload must not win.
      const n = adapter.normalizeEvent(event(eventName, {
        type: 'subscriptions', id: '555', attributes: { status: 'active' },
      }));
      expect(n.subscriptionStatus).toBe(expected);
    });

    it('leaves an unrecognized event unmapped rather than guessing', () => {
      const n = adapter.normalizeEvent(event('license_key_created', {
        type: 'license-keys', id: '1', attributes: {},
      }));
      expect(n.event).toBe('unknown');
      expect(n.status).toBeNull();
      expect(n.subscriptionStatus).toBeNull();
    });

    it('builds a dedupable provider event id from event name + data id', () => {
      const n = adapter.normalizeEvent(event('order_created', {
        type: 'orders', id: '9001', attributes: { status: 'paid' },
      }));
      expect(n.providerEventId).toBe('order_created_9001');
    });

    describe('provider id resolution by payload type', () => {
      it('reads a tx id from an orders payload only', () => {
        const n = adapter.normalizeEvent(event('order_created', {
          type: 'orders', id: '9001', attributes: { status: 'paid' },
        }));
        expect(n.providerTxId).toBe('9001');
        expect(n.providerSubscriptionId).toBeNull();
      });

      it('reads a subscription id from a subscriptions payload', () => {
        const n = adapter.normalizeEvent(event('subscription_created', {
          type: 'subscriptions', id: '555', attributes: { status: 'active' },
        }));
        expect(n.providerSubscriptionId).toBe('555');
        expect(n.providerTxId).toBeNull();
      });

      // Payment success/failure arrives as an invoice whose own id is useless —
      // the subscription id has to come out of attributes.
      it('digs the subscription id out of a subscription-invoices payload', () => {
        const n = adapter.normalizeEvent(event('subscription_payment_success', {
          type: 'subscription-invoices', id: 'inv-1', attributes: { subscription_id: 555 },
        }));
        expect(n.providerSubscriptionId).toBe('555');
        expect(n.providerTxId).toBeNull();
      });

      it('reports no subscription id when the invoice omits it', () => {
        const n = adapter.normalizeEvent(event('subscription_payment_success', {
          type: 'subscription-invoices', id: 'inv-1', attributes: {},
        }));
        expect(n.providerSubscriptionId).toBeNull();
      });

      it('reports neither id for an unrecognized payload type', () => {
        const n = adapter.normalizeEvent(event('order_created', {
          type: 'license-keys', id: '1', attributes: { status: 'paid' },
        }));
        expect(n.providerTxId).toBeNull();
        expect(n.providerSubscriptionId).toBeNull();
      });
    });

    it('carries the AcePay ids out of custom_data', () => {
      const n = adapter.normalizeEvent(event(
        'order_created',
        { type: 'orders', id: '9001', attributes: { status: 'paid' } },
        { acepay_tx: 'tx-1', acepay_subscription: 'sub-1' },
      ));
      expect(n.acepayTxId).toBe('tx-1');
      expect(n.acepaySubscriptionId).toBe('sub-1');
    });

    it('tolerates a payload with no custom_data at all', () => {
      const n = adapter.normalizeEvent(event('order_created', {
        type: 'orders', id: '9001', attributes: { status: 'paid' },
      }));
      expect(n.acepayTxId).toBeNull();
      expect(n.acepaySubscriptionId).toBeNull();
    });

    it('reads occurredAt from created_at, or leaves it null', () => {
      const withTs = adapter.normalizeEvent(event('order_created', {
        type: 'orders', id: '9001', attributes: { status: 'paid', created_at: '2026-05-06T07:08:09Z' },
      }));
      expect(withTs.occurredAt?.toISOString()).toBe('2026-05-06T07:08:09.000Z');
      const without = adapter.normalizeEvent(event('order_created', {
        type: 'orders', id: '9001', attributes: { status: 'paid' },
      }));
      expect(without.occurredAt).toBeNull();
    });
  });

  describe('verifyWebhook edge cases', () => {
    it('rejects an empty signature as missing', () => {
      expect(() => adapter.verifyWebhook(Buffer.from('{}'), ''))
        .toThrow('Missing X-Signature header');
    });

    it('rejects a signature of the wrong length without throwing on buffer size', () => {
      expect(() => adapter.verifyWebhook(Buffer.from('{}'), 'abc123'))
        .toThrow('Invalid Lemon Squeezy webhook signature');
    });

    it('propagates a malformed JSON body once the signature checks out', () => {
      const body = Buffer.from('{not json');
      expect(() => adapter.verifyWebhook(body, sign(body))).toThrow();
    });

    it('verifies an empty-object body', () => {
      const body = Buffer.from('{}');
      expect(adapter.verifyWebhook(body, sign(body))).toEqual({});
    });
  });
});
