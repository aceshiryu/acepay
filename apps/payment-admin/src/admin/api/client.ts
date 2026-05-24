import {
  AdminUser, AppKeyRotated, AppRegistered, AppSummary, AppView, BillingMode,
  CustomerListRow, CustomersStats, Customer,
  DashboardStats, LoginResponse, LookedUpVariant,
  Notification, NotificationSeverity, NotificationStats,
  Paged, Plan, PlanRegion, ProviderHealth,
  Subscription, SubscriptionStats,
  Transaction, TransactionLog, TransactionStats,
  WebhookEvent, WebhookStats,
} from './types';

const TOKEN_STORAGE_KEY = 'acepay.admin.token';
const USER_STORAGE_KEY = 'acepay.admin.user';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}
export function setStoredToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}
export function getStoredUser(): AdminUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as AdminUser) : null;
}
export function setStoredUser(user: AdminUser | null): void {
  if (typeof window === 'undefined') return;
  if (user) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_STORAGE_KEY);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  // Accept any object so call sites with typed query interfaces don't need
  // to add an explicit index signature.
  query?: object;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = getStoredToken();
  const url = new URL(API_BASE_URL + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query as Record<string, unknown>)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let body: unknown = null;
  const text = await resp.text();
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }

  if (!resp.ok) {
    const errBody = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const code =
      typeof errBody.error === 'string' ? errBody.error
        : typeof (errBody.message as { error?: string } | undefined)?.error === 'string'
          ? (errBody.message as { error: string }).error
          : `http_${resp.status}`;
    const message =
      typeof errBody.message === 'string' ? errBody.message
        : typeof (errBody.message as { message?: string } | undefined)?.message === 'string'
          ? (errBody.message as { message: string }).message
          : resp.statusText;
    if (resp.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(resp.status, code, message, body);
  }
  return body as T;
}

// ── Auth ─────────────────────────────────────────────────────────────────
export const auth = {
  login: (email: string, password: string) =>
    request<LoginResponse>('/admin/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request<AdminUser>('/admin/auth/me'),
};

// ── Apps ─────────────────────────────────────────────────────────────────
export interface InlinePlanInput {
  provider: 'lemonsqueezy' | 'xendit';
  title: string;
  description?: string;
  region: PlanRegion;
  // Lemon Squeezy:
  variantId?: string;
  // Xendit (AcePay-managed schedule, no provider plan resource):
  amount?: number;
  currency?: string;
  interval?: 'weekly' | 'monthly' | 'yearly';
  intervalCount?: number;
}
export const apps = {
  list: () => request<{ data: AppView[] }>('/admin/apps'),
  one: (id: string) => request<AppView>(`/admin/apps/${id}`),
  register: (body: {
    name: string;
    slug?: string;
    webhookUrl?: string;
    requiredMetadata?: string[];
    optionalMetadata?: string[];
    rateLimit?: number;
    billingMode: BillingMode;
    plans?: InlinePlanInput[];
  }) => request<AppRegistered>('/admin/apps', { method: 'POST', body }),
  update: (id: string, body: Partial<{
    name: string;
    webhookUrl: string;
    requiredMetadata: string[];
    optionalMetadata: string[];
    rateLimit: number;
    isActive: boolean;
  }>) => request<AppView>(`/admin/apps/${id}`, { method: 'PATCH', body }),
  regenerateKey: (id: string) =>
    request<AppKeyRotated>(`/admin/apps/${id}/regenerate-key`, { method: 'POST' }),
  regenerateWebhookSecret: (id: string) =>
    request<{ app: AppView; webhookSecret: string; warning: string }>(
      `/admin/apps/${id}/regenerate-webhook-secret`, { method: 'POST' },
    ),
  deactivate: (id: string) => request<AppView>(`/admin/apps/${id}`, { method: 'DELETE' }),
  activate: (id: string) => request<AppView>(`/admin/apps/${id}/activate`, { method: 'POST' }),
  testSubscription: (id: string, body: {
    planId: string;
    customerEmail: string;
    customerName?: string;
    redirect?: string;
  }) => request<{
    subscriptionId: string;
    checkoutUrl: string;
    provider: 'lemonsqueezy' | 'xendit';
    customerId: string;
  }>(`/admin/apps/${id}/test-subscription`, { method: 'POST', body }),
};

// ── Settings ─────────────────────────────────────────────────────────────
export interface ProviderHealthRow {
  provider: 'lemonsqueezy' | 'xendit';
  envOk: boolean;
  missingEnv: string[];
  webhookPath: string;
  lastWebhookAt: string | null;
  count24h: number;
  status: 'ok' | 'no_recent' | 'never_received' | 'misconfigured';
}
export interface SettingsHealthResponse {
  providers: ProviderHealthRow[];
  publicBaseHint: string | null;
}
export const settings = {
  health: () => request<SettingsHealthResponse>('/admin/settings/health'),
  simulateWebhook: (body: {
    provider: 'lemonsqueezy' | 'xendit';
    acepaySubscriptionId?: string;
  }) => request<{
    ok: boolean;
    simulated: string;
    payload: Record<string, unknown>;
    result: { duplicate: boolean; eventId: string | null; reason?: string };
  }>('/admin/settings/simulate-webhook', { method: 'POST', body }),
};

// ── Stats ────────────────────────────────────────────────────────────────
export const stats = {
  dashboard: () => request<DashboardStats>('/admin/stats/dashboard'),
  providers: () => request<{ providers: ProviderHealth[] }>('/admin/stats/providers'),
  app: (id: string) => request<AppSummary>(`/admin/stats/apps/${id}`),
};

// ── Transactions ─────────────────────────────────────────────────────────
export interface TxListQuery {
  page?: number; pageSize?: number;
  search?: string; appId?: string; provider?: string; type?: string;
  status?: string; source?: string; from?: string; to?: string;
  customerId?: string; subscriptionId?: string;
}
export const transactions = {
  list: (q: TxListQuery = {}) =>
    request<Paged<Transaction>>('/admin/transactions', { query: q }),
  stats: (q: TxListQuery = {}) =>
    request<TransactionStats>('/admin/transactions/stats', { query: q }),
  one: (id: string) => request<Transaction>(`/admin/transactions/${id}`),
  logs: (id: string) => request<TransactionLog[]>(`/admin/transactions/${id}/logs`),
  refund: (id: string, body: { amount?: number; reason?: string }) =>
    request<Transaction>(`/admin/transactions/${id}/refund`, { method: 'POST', body }),
  sync: (id: string) =>
    request<{ transactionId: string; before: string; after: string; changed: boolean; notifiedApp: boolean }>(
      `/admin/transactions/${id}/sync`, { method: 'POST' },
    ),
  reconcileStale: (body: { staleAfterSeconds?: number; limit?: number } = {}) =>
    request<unknown[]>('/admin/transactions/reconcile-stale', { method: 'POST', body }),
};

// ── Subscriptions ────────────────────────────────────────────────────────
export interface SubListQuery {
  page?: number; pageSize?: number;
  appId?: string; customerId?: string; provider?: string; status?: string;
  from?: string; to?: string;
}
export const subscriptions = {
  list: (q: SubListQuery = {}) => request<Paged<Subscription>>('/admin/subscriptions', { query: q }),
  stats: (q: SubListQuery = {}) => request<SubscriptionStats>('/admin/subscriptions/stats', { query: q }),
  one: (id: string) => request<Subscription>(`/admin/subscriptions/${id}`),
  cancel:     (id: string) => request<Subscription>(`/admin/subscriptions/${id}/cancel`,     { method: 'POST' }),
  reactivate: (id: string) => request<Subscription>(`/admin/subscriptions/${id}/reactivate`, { method: 'POST' }),
  pause:      (id: string) => request<Subscription>(`/admin/subscriptions/${id}/pause`,      { method: 'POST' }),
  resume:     (id: string) => request<Subscription>(`/admin/subscriptions/${id}/resume`,     { method: 'POST' }),
};

// ── Lemon Squeezy ────────────────────────────────────────────────────────
export const lemonsqueezy = {
  lookupVariant: (id: string) =>
    request<LookedUpVariant>(`/admin/lemonsqueezy/variants/${encodeURIComponent(id)}`),
};

// ── Plans ────────────────────────────────────────────────────────────────
export interface PlanListQuery {
  page?: number; pageSize?: number;
  appId?: string; provider?: string; interval?: string; isActive?: boolean;
}
export interface CreatePlanBody {
  appId: string;
  name: string;
  slug: string;
  amount: number;
  currency: string;
  interval: 'weekly' | 'monthly' | 'yearly';
  intervalCount?: number;
  provider: string;
  providerPlanId?: string;
  description?: string;
  region: PlanRegion;
  isActive?: boolean;
}
export const plans = {
  list:    (q: PlanListQuery = {}) => request<Paged<Plan>>('/admin/plans', { query: q }),
  one:     (id: string) => request<Plan>(`/admin/plans/${id}`),
  create:  (body: CreatePlanBody) => request<Plan>('/admin/plans', { method: 'POST', body }),
  update:  (id: string, body: Partial<{
    name: string;
    description: string | null;
    region: PlanRegion;
    amount: number;
    currency: string;
    interval: 'weekly' | 'monthly' | 'yearly';
    intervalCount: number;
    isActive: boolean;
  }>) =>
    request<Plan>(`/admin/plans/${id}`, { method: 'PATCH', body }),
  deactivate: (id: string) => request<Plan>(`/admin/plans/${id}`, { method: 'DELETE' }),
  sync:    (id: string) => request<{ plan: Plan; variant: LookedUpVariant }>(
    `/admin/plans/${id}/sync`, { method: 'POST' },
  ),
};

// ── Customers ────────────────────────────────────────────────────────────
export interface CustomerListQuery {
  page?: number; pageSize?: number;
  appId?: string; search?: string; joinedFrom?: string; joinedTo?: string;
}
export const customers = {
  list: (q: CustomerListQuery = {}) => request<Paged<CustomerListRow>>('/admin/customers', { query: q }),
  stats: () => request<CustomersStats>('/admin/customers/stats'),
  one: (id: string) => request<Customer & {
    subscriptions: Subscription[]; transactions: Transaction[];
  }>(`/admin/customers/${id}`),
};

// ── Webhook Events ───────────────────────────────────────────────────────
export interface WebhookListQuery {
  page?: number; pageSize?: number;
  appId?: string; provider?: string; deliveryStatus?: string; search?: string;
  from?: string; to?: string;
}
export const webhookEvents = {
  list: (q: WebhookListQuery = {}) => request<Paged<WebhookEvent>>('/admin/webhook-events', { query: q }),
  stats: (windowHours = 24) =>
    request<WebhookStats>('/admin/webhook-events/stats', { query: { windowHours } }),
  one: (id: string) => request<WebhookEvent>(`/admin/webhook-events/${id}`),
  retry: (id: string) => request<WebhookEvent>(`/admin/webhook-events/${id}/retry`, { method: 'POST' }),
};

// ── Notifications ────────────────────────────────────────────────────────
export interface NotificationListQuery {
  page?: number; pageSize?: number;
  severity?: NotificationSeverity;
}
export const notifications = {
  list: (q: NotificationListQuery = {}) =>
    request<Paged<Notification>>('/admin/notifications', { query: q }),
  stats: () => request<NotificationStats>('/admin/notifications/stats'),
};

// ── Activity Logs ────────────────────────────────────────────────────────
export interface LogsListQuery {
  page?: number; pageSize?: number;
  appId?: string; transactionId?: string; actor?: string;
  actionPrefix?: string; search?: string; from?: string; to?: string;
}
export const logs = {
  list: (q: LogsListQuery = {}) => request<Paged<TransactionLog>>('/admin/logs', { query: q }),
};
