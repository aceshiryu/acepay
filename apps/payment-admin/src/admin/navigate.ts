'use client';

import { useRouter } from 'next/navigation';
import { Navigate, RoutePage } from './types';

/**
 * Maps the legacy state-router `RoutePage` names to real Next.js URLs.
 * Lets page components keep their `onNavigate(page, param, ctx)` signature
 * while the actual navigation goes through Next's App Router.
 */
const PAGE_TO_PATH: Record<RoutePage, (param?: string | null, ctx?: string | null) => string> = {
  dashboard:             ()           => '/dashboard',
  apps:                  ()           => '/apps',
  'app-detail':          (id)         => `/apps/${id ?? ''}`,
  'register-app':        ()           => '/apps/register',
  integrate:             ()           => '/how-to-use',
  transactions:          (_id, ctx)   => ctx ? `/transactions?app=${ctx}` : '/transactions',
  'transaction-detail':  (id)         => `/transactions/${id ?? ''}`,
  subscriptions:         ()           => '/subscriptions',
  'subscription-detail': (id)         => `/subscriptions/${id ?? ''}`,
  plans:                 ()           => '/plans',
  customers:             ()           => '/customers',
  webhooks:              ()           => '/webhooks',
  'webhook-detail':      (id)         => `/webhooks/${id ?? ''}`,
  logs:                  ()           => '/logs',
  notifications:         ()           => '/notifications',
  settings:              ()           => '/settings',
};

export function pathFor(page: RoutePage, param?: string | null, ctx?: string | null): string {
  const fn = PAGE_TO_PATH[page];
  return fn ? fn(param, ctx) : '/dashboard';
}

export function useNavigate(): Navigate {
  const router = useRouter();
  return (page, param = null, ctx = null) => {
    router.push(pathFor(page, param, ctx));
  };
}
