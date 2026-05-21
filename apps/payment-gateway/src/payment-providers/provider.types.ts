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

export interface PaymentProvider {
  readonly name: Provider;
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  getPayment(providerTxId: string): Promise<FetchedPayment>;
  refund(providerTxId: string, amount?: number): Promise<RefundResult>;

  // Subscriptions — providers that don't support these throw a clear error.
  createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResult>;
  getSubscription(providerSubscriptionId: string): Promise<FetchedSubscription>;
  cancelSubscription(providerSubscriptionId: string): Promise<FetchedSubscription>;
  /** Undo a not-yet-effective cancel (sub still in paid period). */
  uncancelSubscription(providerSubscriptionId: string): Promise<FetchedSubscription>;
  pauseSubscription(providerSubscriptionId: string): Promise<FetchedSubscription>;
  resumeSubscription(providerSubscriptionId: string): Promise<FetchedSubscription>;

  /** Verifies signature and returns the parsed payload, or throws */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): unknown;
  /** Normalizes a verified provider payload into AcePay's event shape */
  normalizeEvent(payload: unknown): NormalizedEvent;
}
