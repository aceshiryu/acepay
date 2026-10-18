import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { signLinkToken, verifyLinkToken } from '../../common/crypto';
import { Provider } from '../../common/enums';
import { Subscription } from '../../database/entities';
import { PAYMONGO_PAY_LINK, PaymongoAdapter, paymongoKeyMode } from '../../payment-providers/paymongo.adapter';
import { ProviderCredentialsService } from '../../payment-providers/provider-credentials.service';
import { payPageCsp, renderPayForm, renderPayMessage } from './pay-page.html';

/** What the controller sends: an HTML page (with its CSP) or a redirect. */
export type PayResponse =
  | { kind: 'html'; status: number; html: string; csp: string }
  | { kind: 'redirect'; url: string };

interface PaymongoMeta {
  successUrl?: string;
  failedUrl?: string;
}

/**
 * The AcePay-hosted page where a customer pays a PayMongo subscription's first
 * invoice (PayMongo has no hosted page for it). Card details go from the
 * browser straight to PayMongo with the PUBLIC key + the payment intent's
 * client key; this server only ever sees ids. Every state is re-read from
 * PayMongo on load, so a stale tab or the back button can't double-charge —
 * a paid intent just redirects to the app.
 */
@Injectable()
export class PaymongoPayService {
  private readonly logger = new Logger(PaymongoPayService.name);

  constructor(
    @InjectRepository(Subscription) private readonly subscriptions: Repository<Subscription>,
    private readonly paymongo: PaymongoAdapter,
    private readonly config: ProviderCredentialsService,
  ) {}

  async page(id: string, token: string | undefined, showError: boolean): Promise<PayResponse> {
    const loaded = await this.load(id, token);
    if ('kind' in loaded) return loaded;
    const { sub, meta } = loaded;
    const nonce = newNonce();

    if (!isAwaitingFirstPayment(sub)) return redirectOr(meta.successUrl, nonce, 'Already paid', 'This subscription is already paid.');

    let ctx;
    try {
      ctx = await this.paymongo.payPageContext(sub.providerSubscriptionId);
    } catch (err) {
      this.logger.error(`PayMongo pay page for ${sub.id}: ${err instanceof Error ? err.message : String(err)}`);
      return message(502, nonce, 'Payment is unavailable', 'We could not reach our payment processor. Please try again in a minute.', null, 0);
    }

    if (ctx.paymentIntentStatus === 'succeeded' || ctx.invoiceStatus === 'paid') {
      return redirectOr(meta.successUrl, nonce, 'Payment received', 'Thanks — your payment went through.');
    }
    if (ctx.subscriptionStatus === 'incomplete_cancelled' || ctx.subscriptionStatus === 'cancelled') {
      return message(410, nonce, 'This payment link has expired',
        'The first payment has to be made within 24 hours. Please start the subscription again from the app.',
        meta.failedUrl ? { label: 'Back to the app', href: meta.failedUrl } : null);
    }
    if (ctx.paymentIntentStatus === 'processing') {
      return message(200, nonce, 'Confirming your payment…', 'This usually takes a few seconds.', null, 3);
    }
    if (!ctx.paymentIntentId || !ctx.clientKey) {
      return message(409, nonce, 'Payment is not ready yet', 'Please refresh this page in a moment.', null, 5);
    }

    let publicKey: string;
    try {
      publicKey = this.paymongo.publicKey();
    } catch {
      return message(503, nonce, 'Payment is unavailable', 'This payment page is not set up yet. Please contact support.');
    }

    const html = renderPayForm({
      nonce,
      planName: ctx.planName ?? sub.plan?.name ?? 'Subscription',
      amountLabel: formatAmount(ctx.amount, ctx.currency),
      email: sub.customer?.email ?? '',
      publicKey,
      clientKey: ctx.clientKey,
      paymentIntentId: ctx.paymentIntentId,
      returnUrl: this.returnUrl(sub.id),
      cancelUrl: meta.failedUrl ?? 'about:blank',
      errorMessage: showError ? (ctx.lastPaymentError ?? 'The payment did not go through. Please try again.') : null,
      testMode: paymongoKeyMode(this.config.get<string>('PAYMONGO_SECRET_KEY')) !== 'live',
    });
    return { kind: 'html', status: 200, html, csp: payPageCsp(nonce) };
  }

  /** Where PayMongo sends the customer after 3-D Secure / Maya. */
  async returned(id: string, token: string | undefined): Promise<PayResponse> {
    const loaded = await this.load(id, token);
    if ('kind' in loaded) return loaded;
    const { sub, meta } = loaded;
    const nonce = newNonce();

    if (!isAwaitingFirstPayment(sub)) return redirectOr(meta.successUrl, nonce, 'Payment received', 'Thanks — your payment went through.');

    let ctx;
    try {
      ctx = await this.paymongo.payPageContext(sub.providerSubscriptionId);
    } catch {
      return message(200, nonce, 'Confirming your payment…', 'This usually takes a few seconds.', null, 3);
    }
    if (ctx.paymentIntentStatus === 'succeeded' || ctx.invoiceStatus === 'paid') {
      return redirectOr(meta.successUrl, nonce, 'Payment received', 'Thanks — your payment went through.');
    }
    if (ctx.paymentIntentStatus === 'awaiting_payment_method') {
      // Declined or abandoned at 3-D Secure: back to the form with the reason.
      return { kind: 'redirect', url: `${this.payPath(sub.id)}&e=1` };
    }
    return message(200, nonce, 'Confirming your payment…', 'This usually takes a few seconds.', null, 3);
  }

  private async load(id: string, token: string | undefined): Promise<{ sub: Subscription; meta: PaymongoMeta } | PayResponse> {
    const nonce = newNonce();
    const notFound = message(404, nonce, 'Payment link not found', 'This link is invalid or incomplete. Please start again from the app.');
    if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyLinkToken(PAYMONGO_PAY_LINK, id, token)) return notFound;
    const sub = await this.subscriptions.findOne({ where: { id }, relations: { plan: true, customer: true } });
    if (!sub || sub.provider !== Provider.Paymongo) return notFound;
    const meta = ((sub.metadata ?? {}) as { paymongo?: PaymongoMeta }).paymongo ?? {};
    return { sub, meta };
  }

  /** Relative to the gateway, so it works behind any PUBLIC_BASE_URL. */
  private payPath(id: string): string {
    return `/v1/pay/paymongo/${id}?t=${signLinkToken(PAYMONGO_PAY_LINK, id)}`;
  }

  private returnUrl(id: string): string {
    const base = (this.config.get<string>('PUBLIC_BASE_URL') ?? '').replace(/\/$/, '');
    return `${base}/v1/pay/paymongo/${id}/return?t=${signLinkToken(PAYMONGO_PAY_LINK, id)}`;
  }
}

function isAwaitingFirstPayment(sub: Subscription): boolean {
  return !!(sub.metadata as Record<string, unknown> | null | undefined)?.awaitingFirstPayment;
}

function newNonce(): string {
  return randomBytes(16).toString('base64');
}

function message(
  status: number, nonce: string, title: string, body: string,
  link: { label: string; href: string } | null = null, refreshSeconds = 0,
): PayResponse {
  return { kind: 'html', status, html: renderPayMessage({ nonce, title, body, link, refreshSeconds }), csp: payPageCsp(nonce) };
}

function redirectOr(url: string | undefined, nonce: string, title: string, body: string): PayResponse {
  return url ? { kind: 'redirect', url } : message(200, nonce, title, body);
}

export function formatAmount(minor: number, currency: string): string {
  const major = (minor / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'PHP' ? `₱${major}` : `${currency} ${major}`;
}
