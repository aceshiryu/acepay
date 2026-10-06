import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { Xendit } from 'xendit-node';
import { PayoutStatus } from '../common/enums';

const XENDIT_API = 'https://api.xendit.co';

export interface XenditSubAccount {
  id: string;
  /** INVITED | REGISTERED | AWAITING_DOCS | PENDING_VERIFICATION | LIVE | SUSPENDED */
  status: string;
  raw: Record<string, unknown>;
}

export interface XenditSplitInvoice {
  id: string;
  invoiceUrl: string;
  created: Date;
  raw: Record<string, unknown>;
}

export interface XenditPayoutResult {
  id: string;
  referenceId: string | null;
  /** Raw Xendit status: REQUESTED | ACCEPTED | LOCKED | SUCCEEDED | FAILED | CANCELLED | REVERSED */
  providerStatus: string;
  status: PayoutStatus;
  failureCode: string | null;
  estimatedArrivalAt: Date | null;
  raw: Record<string, unknown>;
}

export interface XenditPayoutChannel {
  channelCode: string;
  channelName: string;
  channelCategory: string;
  currency: string;
  /** Major units, as Xendit reports them. */
  minimum: number | null;
  maximum: number | null;
}

/**
 * Xendit xenPlatform calls for the marketplace (Slice 6): Owned sub-accounts,
 * split rules, invoices on a sub-account with the platform fee split off,
 * sub-account balances, and payouts from a sub-account.
 *
 * Kept apart from XenditAdapter because none of this is part of the
 * PaymentProvider interface — Lemon Squeezy has no equivalent.
 *
 * xendit-node v7 covers Balance and Payout (both take `forUserId`) but has no
 * Accounts or Split Rules resources, and its Invoice API can't send the
 * `with-split-rule` header — those go over plain HTTP with the same key.
 *
 * Units: AcePay passes MINOR units (centavos) in; Xendit wants MAJOR units.
 */
@Injectable()
export class XenditPlatformClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _sdk: any | null = null;

  constructor(private readonly config: ConfigService) {}

  private secretKey(): string {
    const key = this.config.get<string>('XENDIT_SECRET_KEY');
    if (!key) throw new Error('XENDIT_SECRET_KEY env var is not set');
    return key;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sdk(): any {
    if (!this._sdk) this._sdk = new Xendit({ secretKey: this.secretKey() });
    return this._sdk;
  }

  /** Business ID of the platform (master) account that platform fees are routed to. */
  platformAccountId(): string {
    const id = this.config.get<string>('XENDIT_PLATFORM_ACCOUNT_ID');
    if (!id) {
      throw new Error(
        'Xendit marketplace is not configured: set XENDIT_PLATFORM_ACCOUNT_ID ' +
        '(your master account Business ID, from the Xendit dashboard)',
      );
    }
    return id;
  }

  /** Amount (minor units) left in a sub-account at payout time to cover
   *  Xendit's payout fee, which is charged on top of the payout amount. */
  payoutFeeReserve(): number {
    const raw = Number(this.config.get<string>('XENDIT_PAYOUT_FEE_RESERVE') ?? 2500);
    return Number.isInteger(raw) && raw >= 0 ? raw : 2500;
  }

  private async http<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    try {
      const resp = await axios.request<T>({
        method,
        url: XENDIT_API + path,
        data: body,
        auth: { username: this.secretKey(), password: '' },
        headers: { 'Content-Type': 'application/json', ...headers },
        timeout: 20_000,
      });
      return resp.data;
    } catch (err) {
      const e = err as AxiosError<{ error_code?: string; message?: string }>;
      const status = e.response?.status;
      const code = e.response?.data?.error_code;
      const msg = e.response?.data?.message ?? e.message;
      const wrapped = new Error(`Xendit ${method} ${path} failed${status ? ` (${status}${code ? ` ${code}` : ''})` : ''}: ${msg}`);
      (wrapped as Error & { status?: number; code?: string }).status = status;
      (wrapped as Error & { status?: number; code?: string }).code = code;
      throw wrapped;
    }
  }

  // ─── Sub-accounts ─────────────────────────────────────────────────────

  /**
   * Creates an OWNED sub-account: no KYC for the merchant, the platform
   * controls the balance. Uses /v2/accounts — Xendit marks it legacy in favour
   * of /v3/accounts, which requires the merchant's legal identity and (in live
   * mode) verification. Confirm with Xendit that v2 OWNED stays available for PH.
   */
  async createOwnedAccount(p: { email: string; businessName: string }): Promise<XenditSubAccount> {
    const resp = await this.http<Record<string, unknown>>('POST', '/v2/accounts', {
      email: p.email,
      type: 'OWNED',
      public_profile: { business_name: p.businessName },
    });
    if (!resp?.id) throw new Error('Xendit createAccount returned no id');
    return { id: String(resp.id), status: String(resp.status ?? '').toUpperCase(), raw: resp };
  }

  async getAccount(accountId: string): Promise<XenditSubAccount> {
    const resp = await this.http<Record<string, unknown>>('GET', `/v2/accounts/${encodeURIComponent(accountId)}`);
    return { id: String(resp.id ?? accountId), status: String(resp.status ?? '').toUpperCase(), raw: resp };
  }

  // ─── Split rules + split invoices ─────────────────────────────────────

  /** One route: `percent`% of each payment goes to the platform account. */
  async createPlatformFeeSplitRule(p: { percent: number; currency: string }): Promise<string> {
    // Xendit allows only letters, digits and spaces in a split rule's name and
    // description (no "%", ".", "-"), so 12.5% is written "12 point 5 percent".
    const pct = `${String(p.percent).replace('.', ' point ')} percent`;
    const resp = await this.http<{ id?: string }>('POST', '/split_rules', {
      name: xenditText(`AcePay platform fee ${pct}`),
      description: xenditText(`Routes ${pct} of each marketplace payment to the platform account`),
      routes: [{
        percent_amount: p.percent,
        currency: p.currency.toUpperCase(),
        destination_account_id: this.platformAccountId(),
        reference_id: `acepay-platform-fee-${p.percent}-${p.currency.toUpperCase()}`,
      }],
    });
    if (!resp?.id) throw new Error('Xendit createSplitRule returned no id');
    return String(resp.id);
  }

  /** Hosted invoice on the merchant's sub-account, with the platform fee split
   *  off by `splitRuleId` once the payment settles. */
  async createSplitInvoice(p: {
    forUserId: string;
    /** Omitted for a 0% fee — nothing to split. */
    splitRuleId?: string | null;
    externalId: string;
    amount: number;          // minor units
    currency: string;
    description: string;
    payerEmail?: string | null;
    successRedirectUrl: string;
    failureRedirectUrl: string;
    metadata: Record<string, string>;
    /** Only these methods on the checkout (Xendit codes); omitted = every method on. */
    paymentMethods?: readonly string[] | null;
  }): Promise<XenditSplitInvoice> {
    const resp = await this.http<Record<string, unknown>>('POST', '/v2/invoices', {
      external_id: p.externalId,
      amount: p.amount / 100,
      currency: p.currency.toUpperCase(),
      description: p.description,
      ...(p.payerEmail ? { payer_email: p.payerEmail } : {}),
      success_redirect_url: p.successRedirectUrl,
      failure_redirect_url: p.failureRedirectUrl,
      metadata: p.metadata,
      ...(p.paymentMethods && p.paymentMethods.length > 0 ? { payment_methods: [...p.paymentMethods] } : {}),
    }, {
      'for-user-id': p.forUserId,
      ...(p.splitRuleId ? { 'with-split-rule': p.splitRuleId } : {}),
    });
    if (!resp?.id || !resp.invoice_url) throw new Error('Xendit did not return an invoice URL');
    return {
      id: String(resp.id),
      invoiceUrl: String(resp.invoice_url),
      created: resp.created ? new Date(String(resp.created)) : new Date(),
      raw: resp,
    };
  }

  // ─── Balances + payouts (SDK, on behalf of a sub-account) ─────────────

  /** Live CASH balance of a sub-account, minor units. */
  async getBalance(forUserId: string, currency: string): Promise<number> {
    const resp = await this.sdk().Balance.getBalance({
      accountType: 'CASH',
      currency: currency.toUpperCase(),
      forUserId,
    });
    return Math.round(Number(resp?.balance ?? 0) * 100);
  }

  async listPayoutChannels(currency: string): Promise<XenditPayoutChannel[]> {
    const channels = await this.sdk().Payout.getPayoutChannels({ currency: currency.toUpperCase() });
    return (Array.isArray(channels) ? channels : []).map((c: Record<string, unknown>) => {
      const limits = (c.amountLimits ?? {}) as { minimum?: number; maximum?: number };
      return {
        channelCode: String(c.channelCode ?? ''),
        channelName: String(c.channelName ?? c.channelCode ?? ''),
        channelCategory: String(c.channelCategory ?? ''),
        currency: String(c.currency ?? currency).toUpperCase(),
        minimum: limits.minimum ?? null,
        maximum: limits.maximum ?? null,
      };
    });
  }

  /** Sends money out of a sub-account. `referenceId` (the AcePay payout id) is
   *  also the idempotency key, so a resend can never pay twice. */
  async createPayout(p: {
    forUserId: string;
    referenceId: string;
    channelCode: string;
    accountNumber: string;
    accountHolderName: string;
    amount: number;          // minor units
    currency: string;
    description?: string | null;
    email?: string | null;
  }): Promise<XenditPayoutResult> {
    const resp = await this.sdk().Payout.createPayout({
      idempotencyKey: p.referenceId,
      forUserId: p.forUserId,
      data: {
        referenceId: p.referenceId,
        channelCode: p.channelCode,
        channelProperties: {
          accountNumber: p.accountNumber,
          accountHolderName: p.accountHolderName,
        },
        amount: p.amount / 100,
        currency: p.currency.toUpperCase(),
        description: p.description ?? undefined,
        receiptNotification: p.email ? { emailTo: [p.email] } : undefined,
        metadata: { acepay_payout: p.referenceId },
      },
    });
    return mapPayout(resp);
  }

  async getPayout(xenditPayoutId: string, forUserId?: string | null): Promise<XenditPayoutResult> {
    return mapPayout(await this.sdk().Payout.getPayoutById({
      id: xenditPayoutId,
      ...(forUserId ? { forUserId } : {}),
    }));
  }

  /** Finds a payout by our reference — recovers one whose create response was
   *  lost. Null when Xendit never created it. */
  async findPayoutByReference(referenceId: string, forUserId?: string | null): Promise<XenditPayoutResult | null> {
    const resp = await this.sdk().Payout.getPayouts({
      referenceId,
      limit: 1,
      ...(forUserId ? { forUserId } : {}),
    });
    const first = Array.isArray(resp?.data) ? resp.data[0] : null;
    return first ? mapPayout(first) : null;
  }
}

// ─── Webhook parsing (payload already verified by XenditAdapter.verifyWebhook) ─

export type MarketplaceWebhook =
  | {
      kind: 'payout';
      event: string;
      xenditPayoutId: string;
      referenceId: string | null;
      providerStatus: string;
      status: PayoutStatus;
      failureCode: string | null;
      raw: Record<string, unknown>;
    }
  | {
      kind: 'account';
      event: string;
      accountId: string;
      providerStatus: string;
      raw: Record<string, unknown>;
    }
  | {
      kind: 'split';
      event: string;
      splitId: string;
      status: 'completed' | 'failed';
      /** Minor units actually routed. */
      amount: number | null;
      paymentId: string | null;
      paymentReferenceId: string | null;
      failureCode: string | null;
      raw: Record<string, unknown>;
    }
  | { kind: 'unknown'; event: string; raw: Record<string, unknown> };

/**
 * Normalizes the xenPlatform + payout callbacks AcePay listens to on one URL:
 *  - payout.succeeded / .failed / .reversed (v2) and v3_payout.* (v3)
 *  - account.created / account.updated / account.suspension*
 *  - split.payment
 */
export function parseMarketplaceWebhook(payload: unknown): MarketplaceWebhook {
  const p = (payload ?? {}) as { event?: string; data?: Record<string, unknown> };
  const event = String(p.event ?? '');
  const data = p.data ?? {};
  const raw = p as unknown as Record<string, unknown>;

  if (event.startsWith('payout.') || event.startsWith('v3_payout.')) {
    const id = data.id ?? data.payout_id;
    if (!id) return { kind: 'unknown', event, raw };
    const suffix = event.split('.').pop() ?? '';
    const providerStatus = String(
      data.status ?? (suffix === 'rejected' ? 'FAILED' : suffix),
    ).toUpperCase();
    return {
      kind: 'payout',
      event,
      xenditPayoutId: String(id),
      referenceId: data.reference_id ? String(data.reference_id) : null,
      providerStatus,
      status: mapPayoutStatus(providerStatus),
      failureCode: data.failure_code ? String(data.failure_code) : null,
      raw,
    };
  }

  if (event.startsWith('account.')) {
    const id = data.id ?? (raw as { business_id?: string }).business_id;
    if (!id) return { kind: 'unknown', event, raw };
    return {
      kind: 'account',
      event,
      accountId: String(id),
      providerStatus: String(data.status ?? '').toUpperCase(),
      raw,
    };
  }

  if (event === 'split.payment') {
    if (!data.id) return { kind: 'unknown', event, raw };
    const amt = data.amount != null ? Math.round(Number(data.amount) * 100) : null;
    return {
      kind: 'split',
      event,
      splitId: String(data.id),
      status: String(data.status ?? '').toUpperCase() === 'COMPLETED' ? 'completed' : 'failed',
      amount: Number.isFinite(amt as number) ? amt : null,
      paymentId: data.payment_id ? String(data.payment_id) : null,
      paymentReferenceId: data.payment_reference_id ? String(data.payment_reference_id) : null,
      failureCode: data.failure_code ? String(data.failure_code) : null,
      raw,
    };
  }

  return { kind: 'unknown', event, raw };
}

export function mapPayoutStatus(providerStatus: string): PayoutStatus {
  switch (providerStatus.toUpperCase()) {
    case 'SUCCEEDED': return PayoutStatus.Succeeded;
    case 'FAILED':
    case 'REJECTED':  return PayoutStatus.Failed;
    case 'CANCELLED':
    case 'CANCELED':  return PayoutStatus.Canceled;
    case 'REVERSED':  return PayoutStatus.Reversed;
    // REQUESTED / ACCEPTED / LOCKED / PENDING_COMPLIANCE — still in flight.
    default:          return PayoutStatus.Pending;
  }
}

function mapPayout(resp: Record<string, unknown> | null | undefined): XenditPayoutResult {
  if (!resp?.id) throw new Error('Xendit returned no payout id');
  const providerStatus = String(resp.status ?? 'REQUESTED').toUpperCase();
  const eta = resp.estimatedArrivalTime as string | Date | undefined;
  return {
    id: String(resp.id),
    referenceId: resp.referenceId ? String(resp.referenceId) : null,
    providerStatus,
    status: mapPayoutStatus(providerStatus),
    failureCode: resp.failureCode ? String(resp.failureCode) : null,
    estimatedArrivalAt: eta ? new Date(eta) : null,
    raw: resp,
  };
}

/** Letters, digits and single spaces only: what Xendit accepts in split rule text. */
export function xenditText(text: string): string {
  return text.replace(/[^a-zA-Z0-9 ]+/g, ' ').replace(/ +/g, ' ').trim();
}
