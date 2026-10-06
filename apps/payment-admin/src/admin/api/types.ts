// Mirrors gateway DTOs. Kept narrow — only fields the admin UI uses.

export type Provider = 'lemonsqueezy' | 'xendit';
export type BillingMode = 'subscription' | 'one_time';
export type PlanRegion = 'local' | 'international';
export type Source = 'web' | 'mobile';
export type TxType = 'payment' | 'refund' | 'subscription_payment';
export type TxStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';
export type SubStatus = 'active' | 'past_due' | 'canceled' | 'paused' | 'expired';
export type WebhookDelivery = 'pending' | 'delivered' | 'failed' | 'exhausted';
export type LogActor = 'system' | 'provider' | 'app' | 'admin';

export interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Auth ─────────────────────────────────────────────────────────────────
export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}
export interface LoginResponse {
  token: string;
  user: AdminUser;
}

// ── Apps ─────────────────────────────────────────────────────────────────
export interface AppView {
  id: string;
  /** Human-readable display code (e.g. TXN-000123). Show this, never `id`. */
  code: string;
  name: string;
  slug: string;
  apiKeyPrefix: string;
  webhookUrl: string | null;
  requiredMetadata: string[];
  optionalMetadata: string[];
  rateLimit: number;
  billingMode: BillingMode;
  isActive: boolean;
  /** Xendit codes the app's checkouts offer; null = every method on the Xendit account. */
  paymentMethods?: string[] | null;
  /** The last "Send test webhook". */
  lastPing?: { at: string; ok: boolean | null; detail: string | null } | null;
  createdAt: string;
  updatedAt: string;
}
export interface AppRegistered {
  app: AppView;
  apiKey: string;
  webhookSecret: string;
  plans: Plan[];
  warning?: string;
}

export interface LookedUpVariant {
  variantId: string;
  productId: string;
  productName: string;
  name: string;
  slug: string;
  price: number;
  currency: string;
  isSubscription: boolean;
  interval: 'weekly' | 'monthly' | 'yearly' | null;
  intervalCount: number;
  testMode: boolean;
}
export interface AppKeyRotated {
  app: AppView;
  apiKey: string;
  warning: string;
}

// ── Stats ────────────────────────────────────────────────────────────────
export interface CurrencyAmount {
  currency: string;
  amount: number;
}
export interface DashboardStats {
  now: string;
  transactionsToday: number;
  revenueToday: CurrencyAmount[];
  successRate: number | null;
  activeSubscriptions: number;
  thisWeekVolume: CurrencyAmount[];
  thisMonthVolume: CurrencyAmount[];
  failedWebhooksPending: number;
  totalApps: number;
  activeApps: number;
}
export interface ProviderHealth {
  name: Provider;
  status: 'ok' | 'warn' | 'bad';
  lastWebhookAt: string | null;
}
export interface AppSummary {
  txCount: number;
  revenue: CurrencyAmount[];
  activeSubs: number;
  successRate: number | null;
}

// ── Transactions ─────────────────────────────────────────────────────────
export interface Transaction {
  id: string;
  /** Human-readable display code (e.g. TXN-000123). Show this, never `id`. */
  code: string;
  appId: string;
  customerId: string | null;
  subscriptionId: string | null;
  provider: Provider;
  providerTxId: string | null;
  type: TxType;
  status: TxStatus;
  amount: number;
  currency: string;
  description: string | null;
  metadata: Record<string, unknown>;
  source: Source | null;
  redirectSuccess: string | null;
  redirectFailed: string | null;
  checkoutUrl: string | null;
  createdAt: string;
  providerCreatedAt: string | null;
  providerCompletedAt: string | null;
  webhookReceivedAt: string | null;
  appNotifiedAt: string | null;
  updatedAt: string;
  // populated by detail endpoint:
  app?: AppView;
  customer?: Customer | null;
  subscription?: Subscription | null;
  logs?: TransactionLog[];
  webhookEvents?: WebhookEvent[];
}
export interface TransactionLog {
  id: string;
  transactionId: string;
  appId: string;
  action: string;
  statusFrom: string | null;
  statusTo: string | null;
  actor: LogActor;
  providerEventId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
  // populated by activity logs endpoint:
  app?: AppView;
  transaction?: Transaction | null;
}
export interface TransactionStats {
  total: number;
  succeeded: number;
  pending: number;
  failed: number;
  refunded: number;
}

// ── Subscriptions ────────────────────────────────────────────────────────
export interface Subscription {
  id: string;
  /** Human-readable display code (e.g. TXN-000123). Show this, never `id`. */
  code: string;
  appId: string;
  customerId: string;
  planId: string;
  provider: Provider;
  providerSubscriptionId: string;
  status: SubStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  canceledAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  app?: AppView;
  customer?: Customer;
  plan?: Plan;
  transactions?: Transaction[];
}
export interface Plan {
  id: string;
  /** Human-readable display code (e.g. TXN-000123). Show this, never `id`. */
  code: string;
  appId: string;
  name: string;
  slug: string;
  amount: number;
  currency: string;
  interval: 'weekly' | 'monthly' | 'yearly';
  intervalCount: number;
  provider: Provider;
  providerPlanId: string;
  description: string | null;
  region: PlanRegion;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  app?: AppView;
}
export interface SubscriptionStats {
  total: number;
  active: number;
  past_due: number;
  canceled: number;
  paused: number;
  expired: number;
  mrrEstimate: CurrencyAmount[];
}

// ── Customers ────────────────────────────────────────────────────────────
export interface Customer {
  id: string;
  /** Human-readable display code (e.g. TXN-000123). Show this, never `id`. */
  code: string;
  appId: string;
  externalId: string;
  email: string;
  name: string | null;
  lemonsqueezyCustomerId: string | null;
  xenditCustomerId: string | null;
  xenditPaymentMethodId: string | null;
  xenditPaymentMethodStatus: 'pending' | 'active' | 'expired' | 'failed' | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  app?: AppView;
}
export interface CustomerListRow {
  customer: Customer;
  subscriptionsCount: number;
  transactionsCount: number;
}
export interface CustomersStats {
  total: number;
  withSubscriptions: number;
  joinedThisMonth: number;
  topApp: { id: string; name: string; count: number } | null;
}

// ── Webhook Events ───────────────────────────────────────────────────────
export interface WebhookEvent {
  id: string;
  /** Human-readable display code (e.g. TXN-000123). Show this, never `id`. */
  code: string;
  appId: string;
  transactionId: string | null;
  provider: Provider;
  eventType: string;
  providerEventId: string;
  providerPayload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown> | null;
  deliveryStatus: WebhookDelivery;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  firstAttemptAt: string | null;
  deliveredAt: string | null;
  lastAttemptAt: string | null;
  lastResponseStatus: number | null;
  lastResponseBody: string | null;
  createdAt: string;
  app?: AppView;
  transaction?: Transaction | null;
}
export interface WebhookStats {
  windowHours: number;
  deliveredInWindow: number;
  pending: number;
  failed: number;
  exhausted: number;
  avgDeliveryMs: number | null;
}

// ── Notifications ────────────────────────────────────────────────────────
export type NotificationSeverity = 'critical' | 'warn' | 'info' | 'success';
export type NotificationLinkPage =
  | 'transaction-detail' | 'webhook-detail' | 'subscription-detail' | 'app-detail';

export interface Notification {
  id: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  app: { id: string; name: string } | null;
  createdAt: string;
  link?: { page: NotificationLinkPage; param: string; label: string };
}
export interface NotificationStats {
  total: number;
  critical: number;
  warn: number;
  info: number;
  success: number;
}

// ── Marketplace ──────────────────────────────────────────────────────────
export type MerchantStatus = 'pending' | 'active' | 'paused' | 'suspended';
export type PayoutRunStatus =
  | 'building' | 'build_failed' | 'draft' | 'queued' | 'processing'
  | 'completed' | 'completed_with_failures' | 'discarded';
export type PayoutStatus =
  | 'draft' | 'queued' | 'pending' | 'succeeded' | 'failed' | 'canceled' | 'reversed' | 'skipped';
export type ExclusionReason =
  | 'paused' | 'no_payout_destination' | 'below_minimum' | 'balance_error'
  | 'no_sub_account' | 'payout_in_progress';

export interface MarketplaceSettingsRow {
  appId: string;
  appName: string;
  appSlug: string;
  marketplaceEnabled: boolean;
  feePercent: number | null;
  /** Minor units (centavos). */
  minPayout: number;
  /** Range the app may set its own fee within (via its API key). null = operator-only. */
  feeBounds: { min: number; max: number } | null;
}
export interface MarketplaceAppSummary extends MarketplaceSettingsRow {
  merchants: Partial<Record<MerchantStatus, number>>;
  revenue: Array<{ currency: string; gross: number; platformFees: number; payments: number }>;
  paidOut: number;
  payoutsInFlight: number;
}
export interface MarketplaceSummary {
  payoutFeeReserve: number;
  apps: MarketplaceAppSummary[];
}
export interface MarketplaceChannel {
  channelCode: string;
  channelName: string;
  channelCategory: string;
  currency: string;
  minimum: number | null;
  maximum: number | null;
}

interface MerchantBase {
  id: string;
  /** Human-readable display code (e.g. TXN-000123). Show this, never `id`. */
  code: string;
  appId: string;
  appName: string;
  externalRef: string;
  name: string;
  email: string;
  status: MerchantStatus;
  feePercent: number | null;
  feeOverridePercent: number | null;
  feeOverrideEndsAt: string | null;
  payoutChannelCode: string | null;
  /** Masked, e.g. "•••• 1234". */
  payoutAccount: string | null;
  payoutAccountHolderName: string | null;
  hasPayoutDestination: boolean;
  xenditAccountId: string | null;
  xenditAccountStatus: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
}
export interface MerchantListRow extends MerchantBase {
  duplicateDestinationInApp: boolean;
  sharedDestinationOtherApps: number;
}
export interface MerchantDetail extends MerchantBase {
  payoutAccountNumber: string | null;
  sharedWith: Array<{ merchantId: string; merchantCode: string; name: string; appId: string; appName: string; sameApp: boolean }>;
}
export interface MerchantBalance {
  merchantId: string;
  currency: string;
  available: number;
  payable: number;
  inFlight: number;
  minPayout: number;
}

export interface Payout {
  id: string;
  /** Human-readable display code (e.g. TXN-000123). Show this, never `id`. */
  code: string;
  runId: string | null;
  runCode: string | null;
  merchantId: string;
  appId: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  providerStatus: string | null;
  channelCode: string | null;
  accountNumber: string | null;
  accountHolderName: string | null;
  xenditPayoutId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  retryOf: string | null;
  estimatedArrivalAt: string | null;
  sentAt: string | null;
  completedAt: string | null;
  createdAt: string;
}
export interface PayoutRunPayout extends Payout {
  merchantName: string;
  merchantExternalRef: string;
  appName: string;
  balanceAtBuild: number | null;
}
export interface PayoutExclusion {
  merchantId: string;
  merchantName: string;
  appId: string;
  balance: number | null;
  reason: ExclusionReason;
  detail?: string;
}
export interface PayoutRun {
  id: string;
  /** Human-readable display code (e.g. TXN-000123). Show this, never `id`. */
  code: string;
  appId: string | null;
  app?: { name: string } | null;
  status: PayoutRunStatus;
  currency: string;
  totalAmount: number;
  payoutCount: number;
  excluded: PayoutExclusion[] | null;
  errorMessage: string | null;
  createdBy: string | null;
  builtAt: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}
export interface PayoutRunDetail extends PayoutRun {
  previewExpiresAt: string | null;
  counts: Partial<Record<PayoutStatus, number>>;
  amounts: Partial<Record<PayoutStatus, number>>;
  excluded: PayoutExclusion[];
  payouts: PayoutRunPayout[];
}

export type MarketplaceConfigField =
  | 'marketplace_enabled' | 'marketplace_fee_percent' | 'marketplace_min_payout'
  | 'marketplace_fee_min_percent' | 'marketplace_fee_max_percent';
export interface MarketplaceConfigChange {
  id: string;
  appId: string;
  app?: { name: string } | null;
  actor: 'admin' | 'app';
  /** Admin email, or the API-key prefix when the app made the change. */
  actorRef: string | null;
  field: MarketplaceConfigField;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

/** Template copied onto each app when it's registered. Editing it never changes existing apps. */
export interface MarketplaceDefaults {
  enabled: boolean;
  feePercent: number | null;
  feeMinPercent: number | null;
  feeMaxPercent: number | null;
  /** Minor units (centavos). */
  minPayout: number;
  updatedBy: string | null;
  updatedAt: string | null;
}
