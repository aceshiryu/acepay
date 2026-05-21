export type RoutePage =
  | 'dashboard'
  | 'apps'
  | 'app-detail'
  | 'register-app'
  | 'integrate'
  | 'transactions'
  | 'transaction-detail'
  | 'subscriptions'
  | 'subscription-detail'
  | 'plans'
  | 'customers'
  | 'webhooks'
  | 'webhook-detail'
  | 'logs'
  | 'notifications'
  | 'settings';

export type Navigate = (page: RoutePage, param?: string | null, ctx?: string | null) => void;

export type Crumb = { label: string; onClick?: () => void };
