export type RoutePage =
  | 'dashboard'
  | 'gateways'
  | 'apps'
  | 'app-detail'
  | 'register-app'
  | 'integrate'
  | 'transactions'
  | 'transaction-detail'
  | 'subscriptions'
  | 'subscription-detail'
  | 'plans'
  | 'marketplace'
  | 'merchants'
  | 'merchant-detail'
  | 'payouts'
  | 'payout-run-detail'
  | 'customers'
  | 'webhooks'
  | 'webhook-detail'
  | 'logs'
  | 'notifications'
  | 'settings';

export type Navigate = (page: RoutePage, param?: string | null, ctx?: string | null) => void;

export type Crumb = { label: string; onClick?: () => void };
