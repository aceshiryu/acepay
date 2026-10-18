import { Provider, SubscriptionStatus, TransactionStatus } from '../common/enums';

export interface CreatePaymentParams {
  acepayTxId: string;
  appSlug: string;
  amount: number;        // smallest unit (e.g. centavos)
  currency: string;
  description?: string;
  redirect: { success: string; failed: string };
  metadata: Record<string, unknown>;
  customer?: { email?: string; name?: string };
}

export interface CreatePaymentResult {
  providerTxId: string;
  checkoutUrl: string;
  providerCreatedAt: Date;
  raw: Record<string, unknown>;
}

export interface FetchedPayment {
  providerTxId: string;
  status: TransactionStatus;
  providerCompletedAt: Date | null;
  raw: Record<string, unknown>;
}

export interface RefundResult {
  providerRefundId: string;
  status: TransactionStatus;
  /** What the provider actually refunded (minor units), when it differs from
   *  what was asked — e.g. Lemon Squeezy caps at what it still holds. */
  amount?: number;
  raw: Record<string, unknown>;
}

export interface NormalizedEvent {
  /** AcePay event name (e.g. payment.succeeded) */
  event: string;
  /** Provider's unique event id (for dedup) */
  providerEventId: string;
  /** Provider TX id this event refers to */
  providerTxId: string | null;
  /** Provider Subscription id (set for subscription_* events, null otherwise) */
  providerSubscriptionId?: string | null;
  /** AcePay transaction id, extracted from metadata if present */
  acepayTxId: string | null;
  /** AcePay subscription id, extracted from metadata if present */
  acepaySubscriptionId?: string | null;
  /** Resulting tx status to apply to the transaction, if any */
  status: TransactionStatus | null;
  /** Resulting subscription status to apply, if any */
  subscriptionStatus?: SubscriptionStatus | null;
  /** Provider name */
  provider: Provider;
  /** Raw payload for storage */
  raw: Record<string, unknown>;
  /** Provider event timestamp, if available */
  occurredAt: Date | null;
  /** Start of the billing period a subscription payment covers, when the
   *  payload has no period end of its own (PayMongo invoices carry only a due
   *  date). The webhook handler derives the end from the plan interval. */
  periodStart?: Date | null;
  /** How the customer paid, in AcePay's channel vocabulary (GCASH, PAYMAYA,
   *  CREDIT_CARD, …), when the provider event says so. */
  paymentChannel?: string | null;
  /** Every refund on the payment, as the provider reports it. Lets the
   *  webhook settle AcePay's own refund rows and tell a partial refund from a
   *  full one. Only set by providers whose refund event carries the list. */
  refunds?: Array<{ providerRefundId: string; amount: number; status: TransactionStatus }>;
}

// ─── Subscriptions ──────────────────────────────────────────────────────

export interface CreateSubscriptionParams {
  acepaySubscriptionId: string;
  appSlug: string;
  /** Provider plan id — for Lemon Squeezy this is the Variant ID */
  providerPlanId: string;
  redirect: { success: string; failed: string };
  metadata: Record<string, unknown>;
  customer: { email: string; name?: string };
}

export interface CreateSubscriptionResult {
  /** The provider's checkout id; the actual subscription id arrives via webhook */
  providerCheckoutId: string;
  checkoutUrl: string;
  providerCreatedAt: Date;
  raw: Record<string, unknown>;
  /** Merged into the AcePay subscription's metadata (e.g. PayMongo keeps the
   *  app's redirect URLs there for its AcePay-hosted pay page). */
  providerMetadata?: Record<string, unknown>;
  /** The provider's customer the subscription was created under. Xendit's
   *  renewal charge needs it, and its invoice callback doesn't carry it, so
   *  this is the only chance to keep it. */
  providerCustomerId?: string;
}

export interface FetchedSubscription {
  providerSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAt: Date | null;
  canceledAt: Date | null;
  raw: Record<string, unknown>;
}

/** Per-call routing. `forUserId` is a Xendit sub-account id: marketplace
 *  payments live on the merchant's sub-account, so reading or refunding them
 *  must be done on its behalf. Providers without sub-accounts ignore it. */
export interface ProviderCallOptions {
  forUserId?: string | null;
}

/** Result of the admin "Test connection" button. `mode` is what the
 *  credentials point at (sandbox vs real money), as far as we can tell. */
export interface ConnectionCheck {
  ok: boolean;
  mode: 'test' | 'live' | 'unknown';
  detail: string;
}

export interface PaymentProvider {
  readonly name: Provider;
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  getPayment(providerTxId: string, opts?: ProviderCallOptions): Promise<FetchedPayment>;
  refund(providerTxId: string, amount?: number, opts?: ProviderCallOptions): Promise<RefundResult>;

  // Subscriptions — providers that don't support these throw a clear error.
  createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResult>;
  getSubscription(providerSubscriptionId: string): Promise<FetchedSubscription>;
  cancelSubscription(providerSubscriptionId: string): Promise<FetchedSubscription>;
  /** Undo a not-yet-effective cancel (sub still in paid period). */
  uncancelSubscription(providerSubscriptionId: string): Promise<FetchedSubscription>;
  pauseSubscription(providerSubscriptionId: string): Promise<FetchedSubscription>;
  resumeSubscription(providerSubscriptionId: string): Promise<FetchedSubscription>;

  /** One cheap authenticated read proving the credentials work. Never throws —
   *  a failure comes back as `ok: false` with the provider's message. */
  checkConnection(): Promise<ConnectionCheck>;

  /** Verifies signature and returns the parsed payload, or throws */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): unknown;
  /** Normalizes a verified provider payload into AcePay's event shape */
  normalizeEvent(payload: unknown): NormalizedEvent;
}
