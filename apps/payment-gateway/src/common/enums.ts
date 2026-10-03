export enum Provider {
  Lemonsqueezy = 'lemonsqueezy',
  Xendit = 'xendit',
}

export enum BillingMode {
  Subscription = 'subscription',
  OneTime = 'one_time',
}

export enum XenditPaymentMethodStatus {
  Pending = 'pending',
  Active = 'active',
  Expired = 'expired',
  Failed = 'failed',
}

export enum Source {
  Web = 'web',
  Mobile = 'mobile',
}

export enum TransactionType {
  Payment = 'payment',
  Refund = 'refund',
  SubscriptionPayment = 'subscription_payment',
}

export enum TransactionStatus {
  Pending = 'pending',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Refunded = 'refunded',
  Canceled = 'canceled',
}

export enum SubscriptionStatus {
  Active = 'active',
  PastDue = 'past_due',
  Canceled = 'canceled',
  Paused = 'paused',
  Expired = 'expired',
}

export enum PlanInterval {
  Weekly = 'weekly',
  Monthly = 'monthly',
  Yearly = 'yearly',
}

export enum PlanRegion {
  Local = 'local',
  International = 'international',
}

export enum WebhookDeliveryStatus {
  Pending = 'pending',
  Delivered = 'delivered',
  Failed = 'failed',
  Exhausted = 'exhausted',
}

export enum LogActor {
  System = 'system',
  Provider = 'provider',
  App = 'app',
  Admin = 'admin',
}

export enum LogAction {
  PaymentCreated = 'payment.created',
  PaymentProviderSent = 'payment.provider_sent',
  PaymentCheckoutOpened = 'payment.checkout_opened',
  PaymentSucceeded = 'payment.succeeded',
  PaymentFailed = 'payment.failed',
  PaymentRefundRequested = 'payment.refund_requested',
  PaymentRefunded = 'payment.refunded',
  PaymentWebhookReceived = 'payment.webhook_received',
  PaymentAppNotified = 'payment.app_notified',
  PaymentAppNotifyFailed = 'payment.app_notify_failed',
  PaymentAppNotifyRetry = 'payment.app_notify_retry',
  SubscriptionCreated = 'subscription.created',
  SubscriptionActivated = 'subscription.activated',
  SubscriptionPaymentSucceeded = 'subscription.payment_succeeded',
  SubscriptionPaymentFailed = 'subscription.payment_failed',
  SubscriptionPastDue = 'subscription.past_due',
  SubscriptionCanceled = 'subscription.canceled',
  SubscriptionPaused = 'subscription.paused',
  SubscriptionResumed = 'subscription.resumed',
  SubscriptionExpired = 'subscription.expired',
  SubscriptionRenewed = 'subscription.renewed',
}

/** A marketplace merchant (e.g. a BooklyPH coach) that receives booking money
 *  into its own Xendit sub-account. Only `active` merchants can be charged for. */
export enum MerchantStatus {
  /** Sub-account requested, waiting for Xendit to report it LIVE. */
  Pending = 'pending',
  Active = 'active',
  /** Operator paused: no new payments, excluded from payout runs. */
  Paused = 'paused',
  /** Xendit suspended the sub-account. */
  Suspended = 'suspended',
}

/** Lifecycle of one payout (money OUT of a merchant's sub-account). */
export enum PayoutStatus {
  /** Line in a payout run that hasn't been confirmed yet. */
  Draft = 'draft',
  /** Confirmed; waiting for the worker to send it to Xendit. */
  Queued = 'queued',
  /** Sent to Xendit; REQUESTED / ACCEPTED / LOCKED all collapse to this. */
  Pending = 'pending',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Canceled = 'canceled',
  /** Sent, then bounced back by the bank — the money is in the balance again. */
  Reversed = 'reversed',
  /** Operator unticked it at confirm time. */
  Skipped = 'skipped',
}

/** A one-click payout run across many merchants. */
export enum PayoutRunStatus {
  /** Worker is reading each merchant's live balance. */
  Building = 'building',
  BuildFailed = 'build_failed',
  /** Preview ready for the operator to review and confirm. */
  Draft = 'draft',
  /** Confirmed; waiting for the worker. */
  Queued = 'queued',
  /** Worker is sending payouts / waiting on Xendit results. */
  Processing = 'processing',
  Completed = 'completed',
  CompletedWithFailures = 'completed_with_failures',
  /** Preview thrown away without sending anything. */
  Discarded = 'discarded',
}
