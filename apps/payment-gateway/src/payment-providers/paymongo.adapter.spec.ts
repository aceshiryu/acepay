import { createHmac } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { PlanInterval, Provider, SubscriptionStatus, TransactionStatus } from '../common/enums';

jest.mock('axios', () => {
  const request = jest.fn();
  const get = jest.fn();
  return { __esModule: true, default: { request, get }, request, get };
});

import axios from 'axios';
import { verifyLinkToken } from '../common/crypto';
import {
  mapSubscriptionStatus, PAYMONGO_PAY_LINK, PaymongoAdapter, paymongoKeyMode, parsePaymongoSignature, splitName,
} from './paymongo.adapter';
import { ProviderCredentialsService } from './provider-credentials.service';

const request = axios.request as unknown as jest.Mock;
const get = axios.get as unknown as jest.Mock;

const WEBHOOK_SECRET = 'whsk_test_secret';

function makeConfig(overrides: Record<string, string | undefined> = {}): ProviderCredentialsService {
  const env: Record<string, string | undefined> = {
    PAYMONGO_SECRET_KEY: 'sk_test_abc',
    PAYMONGO_PUBLIC_KEY: 'pk_test_abc',
    PAYMONGO_WEBHOOK_SECRET: WEBHOOK_SECRET,
    PUBLIC_BASE_URL: 'https://pay.acepay.ph/',
    ...overrides,
  };
  return { get: (k: string) => env[k] } as unknown as ProviderCredentialsService;
}

/** Queue axios.request responses in call order: each is the resource under `data`. */
function respond(...resources: Array<Record<string, unknown>>) {
  for (const r of resources) request.mockResolvedValueOnce({ data: { data: r } });
}

/** The `data.attributes` body of the Nth axios.request call. */
function bodyOf(call = 0): Record<string, unknown> {
  return request.mock.calls[call][0].data.data.attributes;
}

function signed(body: unknown, opts: { secret?: string; live?: boolean; t?: number } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  const t = opts.t ?? 1760000000;
  const sig = createHmac('sha256', opts.secret ?? WEBHOOK_SECRET).update(`${t}.${raw.toString()}`).digest('hex');
  return { raw, header: opts.live ? `t=${t},te=,li=${sig}` : `t=${t},te=${sig},li=` };
}

function event(type: string, data: Record<string, unknown>, livemode = false) {
  return { data: { id: 'evt_1', type: 'event', attributes: { type, livemode, created_at: 1760000000, data } } };
}

describe('PaymongoAdapter', () => {
  const OLD_KEY = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  let adapter: PaymongoAdapter;

  beforeAll(() => { process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = 'b'.repeat(64); });
  afterAll(() => { process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = OLD_KEY; });

  beforeEach(() => {
    jest.resetAllMocks();
    adapter = new PaymongoAdapter(makeConfig());
  });

  it('identifies itself as PayMongo', () => {
    expect(adapter.name).toBe(Provider.Paymongo);
  });

  // PayMongo takes centavos like Lemon Squeezy, unlike Xendit. Get this
  // backwards and every charge is off by 100x.
  describe('amount units (minor, passed straight through)', () => {
    it.each([[100], [29900], [150050]])('checkout line item for %p centavos is %p', async (amount) => {
      respond({ id: 'cs_1', attributes: { checkout_url: 'https://checkout.paymongo.com/cs_1' } });
      await adapter.createPayment({
        acepayTxId: 'tx-1', appSlug: 'booklyph', amount, currency: 'php', metadata: {},
        redirect: { success: 'https://bookly.ph/ok', failed: 'https://bookly.ph/no' },
      });
      expect((bodyOf().line_items as Array<{ amount: number }>)[0].amount).toBe(amount);
    });

    it.each([[49900], [100]])('plan of %p centavos is created at %p', async (amount) => {
      respond({ id: 'plan_1', attributes: { name: 'Pro', amount, currency: 'PHP', interval: 'monthly', interval_count: 1 } });
      await adapter.createPlan({ name: 'Pro', amount, currency: 'PHP', interval: PlanInterval.Monthly, intervalCount: 1 });
      expect(bodyOf().amount).toBe(amount);
    });

    it('refunds the exact amount asked for', async () => {
      respond({ id: 'pay_1', attributes: { amount: 49900 } }, { id: 'ref_1', attributes: { status: 'pending' } });
      await adapter.refund('pay_1', 12345);
      expect(bodyOf(1)).toEqual({ amount: 12345, payment_id: 'pay_1', reason: 'others' });
    });
  });

  describe('createPayment', () => {
    it('creates a checkout session with methods, redirects and the AcePay tx id', async () => {
      respond({ id: 'cs_1', attributes: { checkout_url: 'https://checkout.paymongo.com/cs_1', created_at: 1760000000 } });
      const result = await adapter.createPayment({
        acepayTxId: 'tx-1', appSlug: 'booklyph', amount: 50000, currency: 'php', description: 'Court booking',
        metadata: { court: 3 }, customer: { email: 'juan@example.com', name: 'Juan' },
        redirect: { success: 'https://bookly.ph/ok', failed: 'https://bookly.ph/no' },
      });
      expect(request.mock.calls[0][0]).toMatchObject({
        method: 'POST', url: 'https://api.paymongo.com/v1/checkout_sessions',
        auth: { username: 'sk_test_abc', password: '' },
      });
      expect(bodyOf()).toMatchObject({
        payment_method_types: ['card', 'gcash', 'paymaya', 'grab_pay', 'qrph'],
        success_url: 'https://bookly.ph/ok', cancel_url: 'https://bookly.ph/no',
        reference_number: 'tx-1',
        billing: { email: 'juan@example.com', name: 'Juan' },
        metadata: { acepay_tx: 'tx-1', app_slug: 'booklyph', court: '3' },
      });
      expect(result).toMatchObject({ providerTxId: 'cs_1', checkoutUrl: 'https://checkout.paymongo.com/cs_1' });
    });

    it('offers the configured methods instead of the defaults', async () => {
      adapter = new PaymongoAdapter(makeConfig({ PAYMONGO_PAYMENT_METHODS: 'card, gcash' }));
      respond({ id: 'cs_1', attributes: { checkout_url: 'https://x' } });
      await adapter.createPayment({
        acepayTxId: 'tx-1', appSlug: 'a', amount: 100, currency: 'PHP', metadata: {},
        redirect: { success: 'https://a/ok', failed: 'https://a/no' },
      });
      expect(bodyOf().payment_method_types).toEqual(['card', 'gcash']);
    });

    it('surfaces PayMongo\'s error detail', async () => {
      request.mockRejectedValueOnce({ response: { status: 400, data: { errors: [{ code: 'parameter_invalid', detail: 'gcash is not enabled' }] } } });
      await expect(adapter.createPayment({
        acepayTxId: 'tx-1', appSlug: 'a', amount: 100, currency: 'PHP', metadata: {},
        redirect: { success: 'https://a/ok', failed: 'https://a/no' },
      })).rejects.toThrow('PayMongo POST /checkout_sessions failed: gcash is not enabled (parameter_invalid)');
    });
  });

  describe('getPayment', () => {
    it.each([
      ['a paid checkout', 'cs_1', { status: 'active', payments: [{ id: 'pay_1', attributes: { status: 'paid' } }] }, TransactionStatus.Succeeded],
      ['an expired checkout', 'cs_1', { status: 'expired', payments: [] }, TransactionStatus.Failed],
      ['an open checkout', 'cs_1', { status: 'active', payments: [] }, TransactionStatus.Pending],
      ['a succeeded intent', 'pi_1', { status: 'succeeded' }, TransactionStatus.Succeeded],
      ['a declined intent', 'pi_1', { status: 'awaiting_payment_method', last_payment_error: { failed_message: 'declined' } }, TransactionStatus.Failed],
      ['an unpaid intent', 'pi_1', { status: 'awaiting_payment_method' }, TransactionStatus.Pending],
      ['a failed payment', 'pay_1', { status: 'failed' }, TransactionStatus.Failed],
      ['a finished refund', 'ref_1', { status: 'succeeded' }, TransactionStatus.Refunded],
      ['a pending refund', 'ref_1', { status: 'pending' }, TransactionStatus.Pending],
      ['a failed refund', 'ref_1', { status: 'failed' }, TransactionStatus.Failed],
    ])('maps %s', async (_label, id, attributes, status) => {
      respond({ id, attributes });
      await expect(adapter.getPayment(id)).resolves.toMatchObject({ providerTxId: id, status });
    });
  });

  describe('refund', () => {
    it('resolves the paid payment behind an intent and refunds its full amount by default', async () => {
      respond(
        { id: 'pi_1', attributes: { payments: [{ id: 'pay_9', attributes: { amount: 49900, status: 'paid' } }] } },
        { id: 'ref_1', attributes: { status: 'succeeded' } },
      );
      await expect(adapter.refund('pi_1')).resolves.toMatchObject({
        providerRefundId: 'ref_1', status: TransactionStatus.Refunded,
      });
      expect(bodyOf(1)).toEqual({ amount: 49900, payment_id: 'pay_9', reason: 'others' });
    });

    it('refuses when nothing has been paid yet', async () => {
      respond({ id: 'cs_1', attributes: { payments: [] } });
      await expect(adapter.refund('cs_1')).rejects.toThrow('has no payment to refund yet');
    });
  });

  describe('plans', () => {
    it('links an existing plan and takes its values', async () => {
      respond({ id: 'plan_x', attributes: { name: 'Gold', amount: 99900, currency: 'php', interval: 'yearly', interval_count: 1 } });
      await expect(adapter.resolvePlan({ existingPlanId: ' plan_x ', name: 'ignored' })).resolves.toEqual({
        planId: 'plan_x', name: 'Gold', amount: 99900, currency: 'PHP', interval: PlanInterval.Yearly, intervalCount: 1,
      });
      expect(request.mock.calls[0][0]).toMatchObject({ method: 'GET', url: 'https://api.paymongo.com/v1/subscriptions/plans/plan_x' });
    });

    it('creates a plan from the operator\'s values', async () => {
      respond({ id: 'plan_new', attributes: { name: 'Pro', amount: 49900, currency: 'PHP', interval: 'monthly', interval_count: 3 } });
      await adapter.resolvePlan({ name: 'Pro', amount: 49900, currency: 'php', interval: PlanInterval.Monthly, intervalCount: 3 });
      expect(bodyOf()).toEqual({
        name: 'Pro', description: 'Pro', amount: 49900, currency: 'PHP', interval: 'monthly', interval_count: 3,
      });
    });

    it.each([
      ['missing fields', { amount: null }, 'paymongo_plan_fields_required'],
      ['a non-PHP currency', { currency: 'USD' }, 'paymongo_currency_unsupported'],
      ['less than ₱1.00', { amount: 99 }, 'paymongo_amount_too_small'],
      ['more than 10 intervals', { intervalCount: 11 }, 'paymongo_interval_count_invalid'],
    ])('rejects %s without calling PayMongo', async (_label, override, error) => {
      await expect(adapter.resolvePlan({
        name: 'Pro', amount: 49900, currency: 'PHP', interval: PlanInterval.Monthly, intervalCount: 1, ...override,
      })).rejects.toMatchObject({ response: { error } });
      expect(request).not.toHaveBeenCalled();
    });

    it('turns PayMongo refusing a plan into a 400 with PayMongo\'s message', async () => {
      request.mockRejectedValueOnce({ response: { status: 400, data: { errors: [{ code: 'merchant_invalid_state', detail: 'no subscription payment methods are configured for this organization' }] } } });
      await expect(adapter.resolvePlan({ name: 'Pro', amount: 49900, currency: 'PHP', interval: PlanInterval.Monthly }))
        .rejects.toMatchObject({ response: { error: 'paymongo_plan_failed', message: expect.stringContaining('no subscription payment methods') } });
    });

    it('refuses a PayMongo plan on an interval AcePay does not support', async () => {
      respond({ id: 'plan_d', attributes: { interval: 'daily' } });
      await expect(adapter.getPlan('plan_d')).rejects.toThrow('AcePay supports weekly, monthly, yearly');
    });
  });

  describe('createSubscription', () => {
    const params = {
      acepaySubscriptionId: '11111111-2222-4333-8444-555555555555', appSlug: 'booklyph', providerPlanId: 'plan_1',
      customer: { email: 'juan@example.com', name: 'Juan Dela Cruz' }, metadata: {},
      redirect: { success: 'booklyph://paid', failed: 'booklyph://failed' },
    };

    it('creates the customer + subscription and returns a signed AcePay pay link', async () => {
      respond(
        { id: 'cus_1', attributes: {} },
        { id: 'subs_1', attributes: { status: 'incomplete', created_at: 1760000000 } },
      );
      const result = await adapter.createSubscription(params);
      expect(bodyOf(0)).toEqual({ first_name: 'Juan', last_name: 'Dela Cruz', email: 'juan@example.com', default_device: 'email' });
      expect(bodyOf(1)).toEqual({ customer_id: 'cus_1', plan_id: 'plan_1' });
      expect(result.providerCheckoutId).toBe('subs_1');
      expect(result.providerMetadata).toEqual({
        paymongo: { customerId: 'cus_1', successUrl: 'booklyph://paid', failedUrl: 'booklyph://failed' },
      });

      const url = new URL(result.checkoutUrl);
      expect(`${url.origin}${url.pathname}`).toBe(`https://pay.acepay.ph/v1/pay/paymongo/${params.acepaySubscriptionId}`);
      expect(verifyLinkToken(PAYMONGO_PAY_LINK, params.acepaySubscriptionId, url.searchParams.get('t'))).toBe(true);
    });

    it('refuses before calling PayMongo when PUBLIC_BASE_URL is missing', async () => {
      adapter = new PaymongoAdapter(makeConfig({ PUBLIC_BASE_URL: undefined }));
      await expect(adapter.createSubscription(params)).rejects.toThrow('PUBLIC_BASE_URL is not set');
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe('subscription lifecycle', () => {
    it('cancels immediately via POST …/cancel', async () => {
      respond(
        { id: 'subs_1', attributes: {} },
        { id: 'subs_1', attributes: { status: 'cancelled', cancelled_at: 1760000000 } },
      );
      const result = await adapter.cancelSubscription('subs_1');
      expect(request.mock.calls[0][0]).toMatchObject({ method: 'POST', url: 'https://api.paymongo.com/v1/subscriptions/subs_1/cancel' });
      expect(bodyOf(0)).toEqual({ cancellation_reason: 'other' });
      expect(result).toMatchObject({ status: SubscriptionStatus.Canceled, canceledAt: new Date(1760000000 * 1000) });
    });

    it.each([
      ['pause', () => adapter.pauseSubscription()],
      ['resume', () => adapter.resumeSubscription()],
      ['reactivate', () => adapter.uncancelSubscription()],
    ])('refuses to %s with a clear 400', async (_label, call) => {
      await expect(call()).rejects.toBeInstanceOf(BadRequestException);
      await expect(call()).rejects.toMatchObject({ response: { error: 'not_supported_by_provider' } });
    });

    it.each([
      ['incomplete', SubscriptionStatus.Active],
      ['active', SubscriptionStatus.Active],
      ['past_due', SubscriptionStatus.PastDue],
      ['unpaid', SubscriptionStatus.PastDue],
      ['cancelled', SubscriptionStatus.Canceled],
      ['incomplete_cancelled', SubscriptionStatus.Expired],
    ])('maps PayMongo status %s to %s', (status, expected) => {
      expect(mapSubscriptionStatus(status)).toBe(expected);
    });

    it('reads the pay page context from the subscription\'s latest invoice', async () => {
      respond(
        { id: 'subs_1', attributes: { status: 'incomplete', plan: { name: 'Pro' }, latest_invoice: { status: 'open', amount: 49900, currency: 'PHP', payment_intent: { id: 'pi_1', status: 'awaiting_payment_method' } } } },
        { id: 'pi_1', attributes: { status: 'awaiting_payment_method', client_key: 'pi_1_client_x', amount: 49900, currency: 'PHP', last_payment_error: { failed_message: 'Card declined' } } },
      );
      await expect(adapter.payPageContext('subs_1')).resolves.toEqual({
        subscriptionStatus: 'incomplete', invoiceStatus: 'open', paymentIntentId: 'pi_1',
        paymentIntentStatus: 'awaiting_payment_method', clientKey: 'pi_1_client_x',
        amount: 49900, currency: 'PHP', planName: 'Pro', lastPaymentError: 'Card declined',
      });
    });
  });

  describe('verifyWebhook', () => {
    const body = event('payment.paid', { id: 'pay_1', attributes: {} });

    it('accepts a test event signed in te', () => {
      const { raw, header } = signed(body);
      expect(adapter.verifyWebhook(raw, header)).toEqual(body);
    });

    it('accepts a live event signed in li', () => {
      const live = event('payment.paid', { id: 'pay_1', attributes: {} }, true);
      const { raw, header } = signed(live, { live: true });
      expect(adapter.verifyWebhook(raw, header)).toEqual(live);
    });

    it('rejects a live event that only carries a test signature', () => {
      const live = event('payment.paid', { id: 'pay_1', attributes: {} }, true);
      const { raw, header } = signed(live); // signature in te, li empty
      expect(() => adapter.verifyWebhook(raw, header)).toThrow('Malformed Paymongo-Signature header');
    });

    it.each([
      ['a wrong secret', () => signed(body, { secret: 'whsk_other' })],
      ['a tampered body', () => {
        const s = signed(body);
        return { raw: Buffer.from(s.raw.toString().replace('pay_1', 'pay_2')), header: s.header };
      }],
      ['a different timestamp', () => {
        const s = signed(body);
        return { raw: s.raw, header: s.header.replace('t=1760000000', 't=1760000001') };
      }],
    ])('rejects %s', (_label, make) => {
      const { raw, header } = make();
      expect(() => adapter.verifyWebhook(raw, header)).toThrow('Invalid PayMongo webhook signature');
    });

    it('rejects a missing header', () => {
      expect(() => adapter.verifyWebhook(Buffer.from('{}'), undefined)).toThrow('Missing Paymongo-Signature header');
    });

    it('parses the signature header parts', () => {
      expect(parsePaymongoSignature('t=1,te=abc,li=')).toEqual({ t: '1', te: 'abc', li: '' });
    });
  });

  describe('normalizeEvent', () => {
    it('maps a paid checkout to payment.succeeded and swaps to the payment intent id', () => {
      const n = adapter.normalizeEvent(event('checkout_session.payment.paid', {
        id: 'cs_1', attributes: { metadata: { acepay_tx: 'tx-1' }, payment_intent: { id: 'pi_1' } },
      }));
      expect(n).toMatchObject({
        event: 'payment.succeeded', status: TransactionStatus.Succeeded, providerTxId: 'pi_1',
        acepayTxId: 'tx-1', providerEventId: 'evt_1', provider: Provider.Paymongo,
        occurredAt: new Date(1760000000 * 1000),
      });
    });

    it('maps a paid subscription invoice to subscription.payment_succeeded with the period start', () => {
      const n = adapter.normalizeEvent(event('subscription.invoice.paid', {
        id: 'inv_1', attributes: { subscription: { id: 'subs_1' }, payment_intent: { id: 'pi_7' }, due_date: '2026-11-01' },
      }));
      expect(n).toMatchObject({
        event: 'subscription.payment_succeeded', status: TransactionStatus.Succeeded,
        subscriptionStatus: SubscriptionStatus.Active, providerSubscriptionId: 'subs_1', providerTxId: 'pi_7',
        periodStart: new Date('2026-11-01'),
      });
    });

    it.each([
      ['subscription.invoice.payment_failed', { subscription: { id: 'subs_1' }, payment_intent: { id: 'pi_7' } }, 'subscription.payment_failed', null],
      ['subscription.past_due', { status: 'past_due' }, 'subscription.updated', SubscriptionStatus.PastDue],
      ['subscription.unpaid', { status: 'unpaid' }, 'subscription.updated', SubscriptionStatus.PastDue],
      ['subscription.updated', { status: 'cancelled' }, 'subscription.canceled', SubscriptionStatus.Canceled],
      ['subscription.updated', { status: 'incomplete_cancelled' }, 'subscription.expired', SubscriptionStatus.Expired],
      ['subscription.updated', { status: 'active' }, 'subscription.updated', SubscriptionStatus.Active],
    ])('maps %s (%j) to %s', (type, attributes, expectedEvent, subStatus) => {
      const n = adapter.normalizeEvent(event(type, { id: 'subs_1', attributes }));
      expect(n.event).toBe(expectedEvent);
      expect(n.subscriptionStatus).toBe(subStatus);
      expect(n.providerSubscriptionId).toBe('subs_1');
    });

    it('maps a refund to refund.succeeded on the payment intent', () => {
      const n = adapter.normalizeEvent(event('payment.refunded', { id: 'pay_1', attributes: { payment_intent_id: 'pi_1' } }));
      expect(n).toMatchObject({ event: 'refund.succeeded', status: TransactionStatus.Refunded, providerTxId: 'pi_1' });
    });

    const refunded = (amount: number, refunds: Array<[string, number, string]>) => event('payment.refunded', {
      id: 'pay_1',
      attributes: {
        payment_intent_id: 'pi_1', amount,
        refunds: refunds.map(([id, amt, status]) => ({ id, attributes: { amount: amt, status } })),
      },
    });

    it('keeps a partially refunded payment Succeeded and lists the refunds', () => {
      const n = adapter.normalizeEvent(refunded(25000, [['ref_1', 10000, 'succeeded']]));
      expect(n.status).toBe(TransactionStatus.Succeeded);
      expect(n.refunds).toEqual([{ providerRefundId: 'ref_1', amount: 10000, status: TransactionStatus.Refunded }]);
    });

    it('marks the payment Refunded once succeeded refunds cover the whole amount', () => {
      const n = adapter.normalizeEvent(refunded(25000, [['ref_1', 10000, 'succeeded'], ['ref_2', 15000, 'succeeded']]));
      expect(n.status).toBe(TransactionStatus.Refunded);
    });

    it('does not count pending or failed refunds toward the refunded total', () => {
      const n = adapter.normalizeEvent(refunded(25000, [['ref_1', 25000, 'pending'], ['ref_2', 25000, 'failed']]));
      expect(n.status).toBe(TransactionStatus.Succeeded);
      expect(n.refunds!.map((r) => r.status)).toEqual([TransactionStatus.Pending, TransactionStatus.Failed]);
    });

    it.each([
      ['card', 'CREDIT_CARD'], ['gcash', 'GCASH'], ['paymaya', 'PAYMAYA'], ['grab_pay', 'GRABPAY'], ['qrph', 'QRPH'],
    ])('records the %s source of a paid checkout as %s', (sourceType, channel) => {
      const n = adapter.normalizeEvent(event('checkout_session.payment.paid', {
        id: 'cs_1', attributes: {
          payment_intent: { id: 'pi_1' },
          payments: [{ id: 'pay_1', attributes: { status: 'paid', source: { type: sourceType } } }],
        },
      }));
      expect(n.paymentChannel).toBe(channel);
    });

    it('prefers payment_method_used, and reads payments nested in the intent', () => {
      const used = adapter.normalizeEvent(event('checkout_session.payment.paid', {
        id: 'cs_1', attributes: { payment_method_used: 'paymaya', payment_intent: { id: 'pi_1' } },
      }));
      expect(used.paymentChannel).toBe('PAYMAYA');
      const nested = adapter.normalizeEvent(event('checkout_session.payment.paid', {
        id: 'cs_1', attributes: {
          payment_intent: { id: 'pi_1', attributes: { payments: [{ id: 'pay_1', attributes: { status: 'paid', source: { type: 'gcash' } } }] } },
        },
      }));
      expect(nested.paymentChannel).toBe('GCASH');
    });

    it('leaves the channel unknown when PayMongo does not say (card checkouts)', () => {
      const n = adapter.normalizeEvent(event('checkout_session.payment.paid', {
        id: 'cs_1', attributes: { payment_method_used: null, payments: [], payment_intent: { id: 'pi_1', attributes: { payments: [] } } },
      }));
      expect(n.paymentChannel).toBeNull();
    });

    // payment.paid duplicates checkout/invoice events: record it, but with no
    // ids, so it matches nothing and is never forwarded to an app.
    it('keeps unmapped events detached', () => {
      const n = adapter.normalizeEvent(event('payment.paid', { id: 'pay_1', attributes: { payment_intent_id: 'pi_1' } }));
      expect(n).toMatchObject({
        event: 'paymongo.payment.paid', providerTxId: null, providerSubscriptionId: null, acepayTxId: null, status: null,
      });
    });

    it('rejects a payload that is not a PayMongo event', () => {
      expect(() => adapter.normalizeEvent({ hello: 'world' })).toThrow('Not a PayMongo event payload');
    });
  });

  describe('checkConnection', () => {
    it('confirms an enabled webhook points at this gateway', async () => {
      get.mockResolvedValue({ data: { data: [
        { id: 'hook_1', attributes: { status: 'enabled', url: 'https://pay.acepay.ph/v1/webhooks/paymongo' } },
        { id: 'hook_2', attributes: { status: 'disabled', url: 'https://old.ngrok.app/v1/webhooks/paymongo' } },
      ] } });
      await expect(adapter.checkConnection()).resolves.toEqual({
        ok: true, mode: 'test', detail: 'Connected. 2 webhooks registered (1 enabled), including one for this gateway.',
      });
    });

    // The enabled webhook pointing at an old tunnel is why payments never confirm.
    it('warns, naming the URLs, when no enabled webhook points here', async () => {
      get.mockResolvedValue({ data: { data: [
        { id: 'hook_1', attributes: { status: 'enabled', url: 'https://old.ngrok.app/v1/webhooks/paymongo' } },
        { id: 'hook_2', attributes: { status: 'disabled', url: 'https://pay.acepay.ph/v1/webhooks/paymongo' } },
      ] } });
      const r = await adapter.checkConnection();
      expect(r.ok).toBe(true);
      expect(r.detail).toContain("no enabled PayMongo webhook points at https://pay.acepay.ph/v1/webhooks/paymongo");
      expect(r.detail).toContain('https://old.ngrok.app/v1/webhooks/paymongo (enabled)');
      expect(r.detail).toContain('https://pay.acepay.ph/v1/webhooks/paymongo (disabled)');
    });

    it('returns a rejected key as a failed check instead of throwing', async () => {
      get.mockRejectedValue({ response: { status: 401, data: { errors: [{ detail: 'API key is invalid' }] } } });
      await expect(adapter.checkConnection()).resolves.toMatchObject({ ok: false, detail: expect.stringContaining('API key is invalid') });
    });
  });

  describe('helpers', () => {
    it.each([
      ['sk_live_x', 'live'], ['sk_test_x', 'test'], ['pk_live_x', 'unknown'], [undefined, 'unknown'],
    ])('key %p is %p', (key, mode) => expect(paymongoKeyMode(key)).toBe(mode));

    it.each([
      ['Juan Dela Cruz', 'juan@x.ph', { first: 'Juan', last: 'Dela Cruz' }],
      ['Cher', 'cher@x.ph', { first: 'Cher', last: 'Cher' }],
      [undefined, 'maria@x.ph', { first: 'maria', last: 'maria' }],
    ])('splits %p into the two required PayMongo names', (name, email, expected) => {
      expect(splitName(name, email)).toEqual(expected);
    });
  });
});
