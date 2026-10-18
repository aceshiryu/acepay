'use client';

import React from 'react';
import { AppView, Provider } from './api/types';

/**
 * Pages rendered under /apps/<id>/… run inside this scope. List pages read it
 * to pin their `appId` filter, and `useNavigate` reads it to send detail links
 * to the app-scoped URL instead of the old global one.
 */
export interface AppScope {
  app: AppView;
  /** The provider whose menu is open (the app's primary one unless it mixes providers). */
  provider: Provider | null;
  reload: () => void;
}

export const AppScopeContext = React.createContext<AppScope | null>(null);

export function useAppScope(): AppScope | null {
  return React.useContext(AppScopeContext);
}

export function primaryProvider(app: Pick<AppView, 'providers'>): Provider | null {
  return app.providers?.[0] ?? null;
}

export interface AppMenuItem {
  label: string;
  /** Path segment under /apps/<id>/ ('' = overview). */
  segment: string;
  icon: string;
}

/** Overview and App settings can't be hidden (App settings is where you un-hide). */
export const ALWAYS_SHOWN = ['', 'settings'];

/** The inner sidebar for an app, by provider, minus anything the operator hid. */
export function appMenu(provider: Provider | null, opts: { marketplace: boolean; hidden?: string[] }): AppMenuItem[] {
  const hidden = new Set(opts.hidden ?? []);
  return allAppMenuItems(provider, opts).filter((m) => ALWAYS_SHOWN.includes(m.segment) || !hidden.has(m.segment));
}

/** Every item the provider's menu can have, hidden or not. */
export function allAppMenuItems(provider: Provider | null, opts: { marketplace: boolean }): AppMenuItem[] {
  const items: AppMenuItem[] = [{ label: 'Overview', segment: '', icon: 'dash' }];
  if (provider === 'lemonsqueezy') items.push({ label: 'Orders', segment: 'payments', icon: 'tx' });
  else items.push({ label: 'Payments', segment: 'payments', icon: 'tx' });
  items.push(
    { label: 'Subscriptions', segment: 'subscriptions', icon: 'sub' },
  );
  if (provider === 'paymongo') items.push({ label: 'Invoices', segment: 'invoices', icon: 'list' });
  items.push(
    { label: 'Plans', segment: 'plans', icon: 'spade' },
    { label: 'Customers', segment: 'customers', icon: 'cust' },
    { label: 'Refunds', segment: 'refunds', icon: 'arrowDn' },
  );
  if (provider === 'xendit') {
    items.push({ label: 'Payment methods', segment: 'payment-methods', icon: 'wallet' });
    if (opts.marketplace) {
      items.push(
        { label: 'Merchants', segment: 'merchants', icon: 'store' },
        { label: 'Payouts', segment: 'payouts', icon: 'arrowUp' },
      );
    }
  }
  items.push(
    { label: 'Webhook events', segment: 'webhooks', icon: 'hook' },
    { label: 'Activity logs', segment: 'logs', icon: 'log' },
    { label: 'App settings', segment: 'settings', icon: 'settings' },
  );
  return items;
}

export function appPath(appId: string, segment = '', recordId?: string | null): string {
  const base = `/apps/${appId}${segment ? `/${segment}` : ''}`;
  return recordId ? `${base}/${recordId}` : base;
}

/** `?provider=` is only used for legacy apps whose plans mix providers. */
export function withProvider(path: string, provider: Provider | null, app: Pick<AppView, 'providers'>): string {
  return provider && (app.providers?.length ?? 0) > 1 ? `${path}?provider=${provider}` : path;
}

/** Provider filter for a scoped list: only needed when the app mixes providers. */
export function scopedProvider(scope: AppScope | null): Provider | undefined {
  if (!scope || (scope.app.providers?.length ?? 0) < 2) return undefined;
  return scope.provider ?? undefined;
}

export function scopeCrumbs(scope: AppScope, title: string): { label: string }[] {
  return [{ label: scope.app.name }, { label: title }];
}
