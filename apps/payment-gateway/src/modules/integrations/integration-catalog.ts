import { Provider } from '../../common/enums';
import { DEFAULT_PAYMONGO_METHODS } from '../../payment-providers/paymongo.adapter';

/** One env var a provider reads. `secret` values are only ever shown masked. */
export interface CredentialSpec {
  env: string;
  label: string;
  secret: boolean;
  /** Required for the provider to work at all. Optional ones power a feature
   *  (e.g. Xendit marketplace payouts) or have a safe default. */
  required: boolean;
  hint: string;
  /** Checks a value typed on the Integrations page; returns the problem, or null. */
  validate?: (value: string) => string | null;
}

/** A URL the operator pastes into the provider's dashboard. */
export interface WebhookSpec {
  label: string;
  path: string;
  events: string[];
}

export interface IntegrationSpec {
  provider: Provider;
  name: string;
  region: string;
  usedFor: string;
  dashboardUrl: string;
  credentials: CredentialSpec[];
  webhooks: WebhookSpec[];
}

const prefixed = (prefixes: string[], what: string) => (v: string) =>
  prefixes.some((p) => v.startsWith(p)) ? null : `${what} should start with ${prefixes.join(' or ')}`;

/** PayMongo checkout method codes AcePay knows how to offer. */
const PAYMONGO_METHOD_CODES = [
  'card', 'gcash', 'paymaya', 'grab_pay', 'qrph', 'shopee_pay', 'billease',
  'dob', 'dob_ubp', 'brankas_bdo', 'brankas_landbank', 'brankas_metrobank',
];

/** Every payment provider AcePay talks to, in display order. Adding a
 *  provider = adding an entry here + its adapter in the ProviderRegistry. */
export const INTEGRATIONS: IntegrationSpec[] = [
  {
    provider: Provider.Lemonsqueezy,
    name: 'Lemon Squeezy',
    region: 'Global',
    usedFor: 'Subscriptions · cards',
    dashboardUrl: 'https://app.lemonsqueezy.com/settings/api',
    credentials: [
      { env: 'LEMONSQUEEZY_API_KEY', label: 'API key', secret: true, required: true,
        hint: 'Settings → API in Lemon Squeezy.' },
      { env: 'LEMONSQUEEZY_STORE_ID', label: 'Store ID', secret: false, required: true,
        hint: 'Settings → Stores. The number next to your store name.' },
      { env: 'LEMONSQUEEZY_WEBHOOK_SECRET', label: 'Webhook signing secret', secret: true, required: true,
        hint: 'The signing secret you typed when creating the webhook.' },
      { env: 'LEMONSQUEEZY_VARIANT_ID', label: 'Generic charge variant', secret: false, required: false,
        hint: 'Only needed for one-time payments, which AcePay does not offer right now.' },
      { env: 'LEMONSQUEEZY_TEST_MODE', label: 'Test mode', secret: false, required: false,
        hint: 'Leave unset to stay in the sandbox. Only the exact value "false" goes live.',
        validate: (v) => (v === 'true' || v === 'false' ? null : 'Test mode must be exactly "true" or "false"') },
    ],
    webhooks: [
      {
        label: 'Payments + subscriptions',
        path: '/v1/webhooks/lemonsqueezy',
        events: [
          'order_created', 'order_refunded',
          'subscription_created', 'subscription_updated', 'subscription_cancelled',
          'subscription_resumed', 'subscription_paused', 'subscription_expired',
          'subscription_payment_success', 'subscription_payment_failed',
          'subscription_payment_recovered', 'subscription_payment_refunded',
        ],
      },
    ],
  },
  {
    provider: Provider.Xendit,
    name: 'Xendit',
    region: 'Philippines',
    usedFor: 'Invoices · recurring · marketplace',
    dashboardUrl: 'https://dashboard.xendit.co/settings/developers',
    credentials: [
      { env: 'XENDIT_SECRET_KEY', label: 'Secret key', secret: true, required: true,
        hint: 'Settings → Developers → API keys. A xnd_development_ key is sandbox, xnd_production_ is real money.',
        validate: prefixed(['xnd_development_', 'xnd_production_'], 'A Xendit secret key') },
      { env: 'XENDIT_WEBHOOK_TOKEN', label: 'Webhook verification token', secret: true, required: true,
        hint: 'Settings → Developers → Webhooks → Verification token.' },
      { env: 'XENDIT_PLATFORM_ACCOUNT_ID', label: 'Platform account ID', secret: false, required: false,
        hint: 'Your master Business ID. Needed for marketplace payments only.',
        validate: (v) => (/^[0-9a-f]{24}$/i.test(v) ? null : 'The platform account ID is your Xendit Business ID: 24 hex characters') },
      { env: 'XENDIT_PAYOUT_FEE_RESERVE', label: 'Payout fee reserve', secret: false, required: false,
        hint: 'Centavos left in each merchant sub-account to cover Xendit\'s payout fee. Defaults to 2500.',
        validate: (v) => (/^\d+$/.test(v) ? null : 'The payout fee reserve is a whole number of centavos') },
    ],
    webhooks: [
      {
        label: 'Invoices + saved payment methods',
        path: '/v1/webhooks/xendit',
        events: ['Invoices paid / expired', 'Payment method status'],
      },
      {
        label: 'Marketplace',
        path: '/v1/webhooks/xendit/marketplace',
        events: ['Payouts', 'Account status (account.*)', 'Split payments (split.payment)'],
      },
    ],
  },
  {
    provider: Provider.Paymongo,
    name: 'PayMongo',
    region: 'Philippines',
    usedFor: 'Subscriptions (card, Maya) · checkout',
    dashboardUrl: 'https://dashboard.paymongo.com/developers',
    credentials: [
      { env: 'PAYMONGO_SECRET_KEY', label: 'Secret key', secret: true, required: true,
        hint: 'Developers → API keys. sk_test_ is the sandbox, sk_live_ is real money.',
        validate: prefixed(['sk_test_', 'sk_live_'], 'A PayMongo secret key') },
      { env: 'PAYMONGO_PUBLIC_KEY', label: 'Public key', secret: false, required: true,
        hint: 'Developers → API keys (pk_…). Used on the AcePay pay page so card details go straight from the customer\'s browser to PayMongo.',
        validate: prefixed(['pk_test_', 'pk_live_'], 'A PayMongo public key') },
      { env: 'PAYMONGO_WEBHOOK_SECRET', label: 'Webhook signing secret', secret: true, required: true,
        hint: 'The whsk_… secret PayMongo shows once when you create the webhook below.',
        validate: prefixed(['whsk_'], 'A PayMongo webhook secret') },
      { env: 'PAYMONGO_PAYMENT_METHODS', label: 'Checkout methods', secret: false, required: false,
        hint: `Comma-separated, for one-time checkouts. Defaults to ${DEFAULT_PAYMONGO_METHODS.join(', ')}. Each must be activated on your PayMongo account. Subscriptions always offer card + Maya.`,
        validate: (v) => {
          const bad = v.split(',').map((s) => s.trim()).filter((s) => s && !PAYMONGO_METHOD_CODES.includes(s));
          return bad.length ? `Unknown PayMongo method${bad.length > 1 ? 's' : ''}: ${bad.join(', ')}` : null;
        } },
    ],
    webhooks: [
      {
        label: 'Payments + subscriptions',
        path: '/v1/webhooks/paymongo',
        events: [
          'checkout_session.payment.paid', 'payment.refunded',
          'subscription.invoice.paid', 'subscription.invoice.payment_failed',
          'subscription.past_due', 'subscription.unpaid', 'subscription.updated',
        ],
      },
    ],
  },
];

export function integrationSpec(provider: Provider): IntegrationSpec | undefined {
  return INTEGRATIONS.find((i) => i.provider === provider);
}
