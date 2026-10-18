// Stub the entity barrel (its App → … → App cycle is a TDZ error under swc-jest).
jest.mock('../../database/entities', () => ({ Subscription: class Subscription {} }));

import { Repository } from 'typeorm';
import { signLinkToken } from '../../common/crypto';
import { Provider } from '../../common/enums';
import { Subscription } from '../../database/entities';
import { PAYMONGO_PAY_LINK, PaymongoAdapter, PaymongoPayContext } from '../../payment-providers/paymongo.adapter';
import { ProviderCredentialsService } from '../../payment-providers/provider-credentials.service';
import { escapeHtml } from './pay-page.html';
import { formatAmount, PaymongoPayService, PayResponse } from './paymongo-pay.service';

const SUB_ID = '11111111-2222-4333-8444-555555555555';

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: SUB_ID,
    provider: Provider.Paymongo,
    providerSubscriptionId: 'subs_1',
    metadata: {
      awaitingFirstPayment: true,
      paymongo: { successUrl: 'booklyph://paid', failedUrl: 'booklyph://failed' },
    },
    plan: { name: 'Pro Monthly' },
    customer: { email: 'juan@example.com' },
    ...overrides,
  } as unknown as Subscription;
}

function ctx(overrides: Partial<PaymongoPayContext> = {}): PaymongoPayContext {
  return {
    subscriptionStatus: 'incomplete', invoiceStatus: 'open', paymentIntentId: 'pi_1',
    paymentIntentStatus: 'awaiting_payment_method', clientKey: 'pi_1_client_secret',
    amount: 49900, currency: 'PHP', planName: 'Pro Monthly', lastPaymentError: null,
    ...overrides,
  };
}

function html(r: PayResponse): string {
  if (r.kind !== 'html') throw new Error(`expected html, got redirect to ${r.url}`);
  return r.html;
}

describe('PaymongoPayService', () => {
  const OLD_KEY = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  let subs: { findOne: jest.Mock };
  let paymongo: { payPageContext: jest.Mock; publicKey: jest.Mock };
  let service: PaymongoPayService;
  let token: string;

  beforeAll(() => {
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = 'c'.repeat(64);
    token = signLinkToken(PAYMONGO_PAY_LINK, SUB_ID);
  });
  afterAll(() => { process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = OLD_KEY; });

  beforeEach(() => {
    subs = { findOne: jest.fn().mockResolvedValue(sub()) };
    paymongo = {
      payPageContext: jest.fn().mockResolvedValue(ctx()),
      publicKey: jest.fn().mockReturnValue('pk_test_abc'),
    };
    const env: Record<string, string> = { PAYMONGO_SECRET_KEY: 'sk_test_abc', PUBLIC_BASE_URL: 'https://pay.acepay.ph' };
    service = new PaymongoPayService(
      subs as unknown as Repository<Subscription>,
      paymongo as unknown as PaymongoAdapter,
      { get: (k: string) => env[k] } as unknown as ProviderCredentialsService,
    );
  });

  describe('the link is the credential', () => {
    it.each([
      ['no token', undefined],
      ['a forged token', 'not-the-token'],
      ['a token for another purpose', 'x'],
    ])('404s with %s, without touching the database', async (_label, t) => {
      const r = await service.page(SUB_ID, t === 'x' ? signLinkToken('other-purpose', SUB_ID) : t, false);
      expect(r).toMatchObject({ kind: 'html', status: 404 });
      expect(subs.findOne).not.toHaveBeenCalled();
    });

    it('404s for a subscription on another provider', async () => {
      subs.findOne.mockResolvedValue(sub({ provider: Provider.Xendit }));
      await expect(service.page(SUB_ID, token, false)).resolves.toMatchObject({ status: 404 });
      expect(paymongo.payPageContext).not.toHaveBeenCalled();
    });

    it('404s for a malformed id', async () => {
      await expect(service.page('../../etc', token, false)).resolves.toMatchObject({ status: 404 });
    });
  });

  describe('page', () => {
    it('renders the card + Maya form with only the public key and the client key', async () => {
      const r = await service.page(SUB_ID, token, false);
      expect(r).toMatchObject({ kind: 'html', status: 200 });
      const page = html(r);
      expect(page).toContain('₱499.00');
      expect(page).toContain('"pk_test_abc"');
      expect(page).toContain('"pi_1_client_secret"');
      expect(page).toContain('Pay with Maya');
      expect(page).toContain('TEST MODE');
      expect(page).not.toContain('sk_test_abc');
      expect(page).toContain(`"https://pay.acepay.ph/v1/pay/paymongo/${SUB_ID}/return?t=${token}"`);
    });

    it('locks the page down: nonce-only scripts, PayMongo as the only API it may call', async () => {
      const r = await service.page(SUB_ID, token, false);
      if (r.kind !== 'html') throw new Error('expected html');
      const nonce = /script-src 'nonce-([^']+)'/.exec(r.csp)?.[1];
      expect(nonce).toBeTruthy();
      expect(r.csp).toContain('connect-src https://api.paymongo.com');
      expect(r.csp).toContain("default-src 'none'");
      expect(r.html).toContain(`<script nonce="${nonce}">`);
    });

    it('shows the decline reason after a failed attempt', async () => {
      paymongo.payPageContext.mockResolvedValue(ctx({ lastPaymentError: 'Insufficient funds' }));
      expect(html(await service.page(SUB_ID, token, true))).toContain('Insufficient funds');
    });

    it('escapes values from the provider so they cannot inject markup', async () => {
      paymongo.payPageContext.mockResolvedValue(ctx({ planName: '<img src=x onerror=alert(1)>' }));
      const page = html(await service.page(SUB_ID, token, false));
      expect(page).not.toContain('<img src=x');
      expect(page).toContain(escapeHtml('<img src=x onerror=alert(1)>'));
    });

    it('cannot break out of the inline script through a provider value', async () => {
      paymongo.payPageContext.mockResolvedValue(ctx({ clientKey: '</script><script>alert(1)</script>' }));
      expect(html(await service.page(SUB_ID, token, false))).not.toContain('</script><script>alert(1)');
    });

    // A stale tab or the back button must never offer a second charge.
    it.each([
      ['the webhook already marked it paid', () => subs.findOne.mockResolvedValue(sub({ metadata: { paymongo: { successUrl: 'booklyph://paid' } } }))],
      ['PayMongo says the intent succeeded', () => paymongo.payPageContext.mockResolvedValue(ctx({ paymentIntentStatus: 'succeeded' }))],
      ['PayMongo says the invoice is paid', () => paymongo.payPageContext.mockResolvedValue(ctx({ invoiceStatus: 'paid' }))],
    ])('redirects to the app when %s', async (_label, arrange) => {
      arrange();
      await expect(service.page(SUB_ID, token, false)).resolves.toEqual({ kind: 'redirect', url: 'booklyph://paid' });
    });

    it('says the link expired once PayMongo gave up on the first payment', async () => {
      paymongo.payPageContext.mockResolvedValue(ctx({ subscriptionStatus: 'incomplete_cancelled' }));
      const r = await service.page(SUB_ID, token, false);
      expect(r).toMatchObject({ status: 410 });
      expect(html(r)).toContain('booklyph://failed');
    });

    it('waits (auto-refresh) while PayMongo is still processing', async () => {
      paymongo.payPageContext.mockResolvedValue(ctx({ paymentIntentStatus: 'processing' }));
      expect(html(await service.page(SUB_ID, token, false))).toContain('http-equiv="refresh"');
    });

    it('shows a friendly 502 when PayMongo is unreachable', async () => {
      paymongo.payPageContext.mockRejectedValue(new Error('ECONNRESET'));
      const r = await service.page(SUB_ID, token, false);
      expect(r).toMatchObject({ status: 502 });
      expect(html(r)).not.toContain('ECONNRESET');
    });

    it('shows a 503 when the public key is not set up', async () => {
      paymongo.publicKey.mockImplementation(() => { throw new Error('PAYMONGO_PUBLIC_KEY env var is not set'); });
      const r = await service.page(SUB_ID, token, false);
      expect(r).toMatchObject({ status: 503 });
      expect(html(r)).not.toContain('PAYMONGO_PUBLIC_KEY');
    });
  });

  describe('returned (after 3-D Secure / Maya)', () => {
    it('sends the customer to the app once paid', async () => {
      paymongo.payPageContext.mockResolvedValue(ctx({ paymentIntentStatus: 'succeeded' }));
      await expect(service.returned(SUB_ID, token)).resolves.toEqual({ kind: 'redirect', url: 'booklyph://paid' });
    });

    it('goes back to the form with the error shown when the payment was declined', async () => {
      await expect(service.returned(SUB_ID, token)).resolves.toEqual({
        kind: 'redirect', url: `/v1/pay/paymongo/${SUB_ID}?t=${token}&e=1`,
      });
    });

    it('waits while the payment is still processing', async () => {
      paymongo.payPageContext.mockResolvedValue(ctx({ paymentIntentStatus: 'processing' }));
      expect(html(await service.returned(SUB_ID, token))).toContain('Confirming your payment');
    });

    it('rejects a forged return link', async () => {
      await expect(service.returned(SUB_ID, 'forged')).resolves.toMatchObject({ status: 404 });
    });
  });

  it.each([
    [49900, 'PHP', '₱499.00'],
    [150050, 'PHP', '₱1,500.50'],
    [100, 'USD', 'USD 1.00'],
  ])('formats %p %s as %s', (minor, currency, expected) => {
    expect(formatAmount(minor, currency)).toBe(expected);
  });
});
