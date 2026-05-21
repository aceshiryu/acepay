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
