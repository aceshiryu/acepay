'use client';

import React, { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as api from './api/client';
import { Provider } from './api/types';
import { useFetch } from './api/use-fetch';
import { AppScopeContext, appMenu, appPath, primaryProvider, withProvider } from './app-scope';
import { useAppsChanged } from './events';
import { HEALTH_DOT } from './layout';
import { AppAvatar, Icon } from './primitives';
import { PROVIDER_THEME, providerTheme } from './provider-theme';

/**
 * Everything under /apps/<id>/ renders inside this shell: an inner sidebar with
 * the app's provider menu, and an AppScope so pages filter to this app. The
 * whole subtree is wrapped in `data-provider`, so it takes the provider's
 * colours (see global.css).
 */
export function AppShell({ appId, children }: { appId: string; children: ReactNode }) {
  const app = useFetch(() => api.apps.one(appId), [appId]);
  const status = useFetch(() => api.apps.status(appId), [appId]);
  const search = useSearchParams();
  const reload = React.useCallback(() => { app.refetch(); status.refetch(); }, [app.refetch, status.refetch]);
  useAppsChanged(reload);

  if (app.error) {
    return (
      <div style={{ padding: 40, color: 'var(--bad)', fontSize: 13 }}>
        Couldn't load this app: {app.error.message}
      </div>
    );
  }
  if (!app.data) {
    return <div style={{ padding: 40, color: 'var(--muted)', fontSize: 13 }}>Loading app…</div>;
  }

  const a = app.data;
  const requested = search?.get('provider') as Provider | null;
  const provider = requested && a.providers.includes(requested) ? requested : primaryProvider(a);

  return (
    <AppScopeContext.Provider value={{ app: a, provider, reload }}>
      <div data-provider={provider ?? undefined} style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: '100vh' }}>
        <InnerSidebar
          provider={provider}
          appName={a.name}
          appCode={a.code}
          appId={a.id}
          providers={a.providers}
          marketplace={a.marketplaceEnabled}
          hidden={a.hiddenMenus ?? []}
          health={status.data?.status ?? null}
          isActive={a.isActive}
        />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>
    </AppScopeContext.Provider>
  );
}

function InnerSidebar({ provider, appName, appCode, appId, providers, marketplace, hidden, health, isActive }: {
  provider: Provider | null;
  appName: string;
  appCode: string;
  appId: string;
  providers: Provider[];
  marketplace: boolean;
  hidden: string[];
  health: keyof typeof HEALTH_DOT | null;
  isActive: boolean;
}) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const theme = providerTheme(provider);
  const items = appMenu(provider, { marketplace, hidden });
  const base = appPath(appId);
  const app = { providers };

  return (
    <aside style={{
      width: 208, flexShrink: 0, background: 'var(--surface-2)',
      borderRight: '1px solid var(--hairline)',
      height: '100vh', position: 'sticky', top: 0, overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        background: theme?.brand ?? 'var(--brand-card)', color: theme?.onBrand ?? '#fff',
        padding: '16px 14px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AppAvatar name={appName} size={32} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: -0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{appName}</div>
            <div className="mono" style={{ fontSize: 11, opacity: 0.8 }}>{appCode}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
            background: 'rgba(255,255,255,0.25)',
          }}>{theme?.label ?? 'No provider yet'}</span>
          {health && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
              background: '#fff', color: 'var(--ink)',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: 6, background: HEALTH_DOT[health].color }} />
              {isActive ? HEALTH_DOT[health].label : 'Inactive'}
            </span>
          )}
        </div>
      </div>

      {providers.length > 1 && (
        <div style={{ padding: '10px 10px 0' }}>
          <div style={{ fontSize: 10.5, color: 'var(--muted)', padding: '0 4px 6px' }}>
            This app's plans use more than one provider.
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {providers.map((p) => (
              <button
                key={p}
                onClick={() => router.push(`${pathname}?provider=${p}`)}
                style={{
                  flex: 1, padding: '4px 6px', fontSize: 11, fontWeight: 650, borderRadius: 7,
                  border: `1px solid ${p === provider ? 'var(--accent)' : 'var(--border)'}`,
                  background: p === provider ? 'var(--accent-soft)' : 'var(--surface)',
                  color: p === provider ? 'var(--accent-text)' : 'var(--ink-2)',
                }}
              >{PROVIDER_THEME[p].short}</button>
            ))}
          </div>
        </div>
      )}

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '12px 10px' }}>
        {items.map((m) => {
          const href = appPath(appId, m.segment);
          const active = m.segment === ''
            ? pathname === base
            : pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={m.segment || 'overview'}
              href={withProvider(href, provider, app)}
              className="nav-link"
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '7px 9px', borderRadius: 9, fontSize: 12.5,
                fontWeight: active ? 650 : 500,
                background: active ? 'var(--accent-soft)' : undefined,
                color: active ? 'var(--accent-text)' : 'var(--ink-2)',
              }}
            >
              <Icon name={m.icon} size={14} strokeWidth={1.9} color={active ? 'var(--accent-text)' : 'var(--muted)'} />
              {m.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
