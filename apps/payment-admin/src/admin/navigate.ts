'use client';

import { useRouter } from 'next/navigation';
import { appPath, useAppScope } from './app-scope';
import { Navigate, RoutePage } from './types';

/**
 * Maps the legacy state-router `RoutePage` names to real Next.js URLs.
 * Lets page components keep their `onNavigate(page, param, ctx)` signature
 * while the actual navigation goes through Next's App Router.
 *
 * Records live under their app (/apps/<appId>/…). Global record URLs such as
 * /transactions/<id> still work: they look the record up and redirect.
 */
const PAGE_TO_PATH: Record<RoutePage, (param?: string | null, ctx?: string | null) => string> = {
  dashboard:             ()           => '/dashboard',
  gateways:              ()           => '/dashboard',
  apps:                  ()           => '/apps',
  'app-detail':          (id)         => `/apps/${id ?? ''}`,
  'app-settings':        (id)         => appPath(id ?? '', 'settings'),
  'register-app':        ()           => '/apps/new',
  integrate:             ()           => '/how-to-use',
  transactions:          (_id, ctx)   => ctx ? appPath(ctx, 'payments') : '/dashboard',
  'transaction-detail':  (id)         => `/transactions/${id ?? ''}`,
  refunds:               (_id, ctx)   => ctx ? appPath(ctx, 'refunds') : '/dashboard',
  subscriptions:         (_id, ctx)   => ctx ? appPath(ctx, 'subscriptions') : '/dashboard',
  'subscription-detail': (id)         => `/subscriptions/${id ?? ''}`,
  plans:                 (_id, ctx)   => ctx ? appPath(ctx, 'plans') : '/dashboard',
  marketplace:           ()           => '/providers/xendit',
  merchants:             (_id, ctx)   => ctx ? appPath(ctx, 'merchants') : '/dashboard',
  'merchant-detail':     (id)         => `/merchants/${id ?? ''}`,
  payouts:               (_id, ctx)   => ctx ? appPath(ctx, 'payouts') : '/dashboard',
  'payout-run-detail':   (id)         => `/payouts/${id ?? ''}`,
  customers:             (_id, ctx)   => ctx ? appPath(ctx, 'customers') : '/dashboard',
  webhooks:              (_id, ctx)   => ctx ? appPath(ctx, 'webhooks') : '/dashboard',
  'webhook-detail':      (id)         => `/webhooks/${id ?? ''}`,
  logs:                  ()           => '/logs',
  notifications:         ()           => '/notifications',
  integrations:          ()           => '/providers/lemonsqueezy',
  'provider-config':     (p)          => `/providers/${p ?? 'lemonsqueezy'}`,
};

/** Inside an app, list + detail pages resolve to that app's own URLs. */
const SCOPED: Partial<Record<RoutePage, [segment: string, withId: boolean]>> = {
  transactions:          ['payments', false],
  'transaction-detail':  ['payments', true],
  refunds:               ['refunds', false],
  subscriptions:         ['subscriptions', false],
  'subscription-detail': ['subscriptions', true],
  plans:                 ['plans', false],
  customers:             ['customers', false],
  merchants:             ['merchants', false],
  'merchant-detail':     ['merchants', true],
  payouts:               ['payouts', false],
  'payout-run-detail':   ['payouts', true],
  webhooks:              ['webhooks', false],
  'webhook-detail':      ['webhooks', true],
  logs:                  ['logs', false],
  'app-settings':        ['settings', false],
};

export function pathFor(page: RoutePage, param?: string | null, ctx?: string | null, scopeAppId?: string | null): string {
  const scoped = SCOPED[page];
  const appId = ctx ?? scopeAppId;
  if (scoped && appId) {
    const [segment, withId] = scoped;
    return appPath(appId, segment, withId ? param : null);
  }
  const fn = PAGE_TO_PATH[page];
  return fn ? fn(param, ctx) : '/dashboard';
}

export function useNavigate(): Navigate {
  const router = useRouter();
  const scope = useAppScope();
  return (page, param = null, ctx = null) => {
    router.push(pathFor(page, param, ctx, scope?.app.id ?? null));
  };
}
