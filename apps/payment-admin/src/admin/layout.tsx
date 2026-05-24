'use client';

import React, { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as api from './api/client';
import { useFetch } from './api/use-fetch';
import { AceLogo, Icon, SearchInput } from './primitives';
import { NAV } from './data';
import { Crumb } from './types';
import { useAuth } from './auth/auth-context';

/**
 * Sidebar derives its active state from the URL pathname rather than a
 * prop. Each nav item is a real <Link> so middle-click / right-click /
 * cmd-click all work the way users expect.
 */
export function Sidebar() {
  const pathname = usePathname() ?? '/';
  const { user, logout } = useAuth();
  const initial = (user?.name?.[0] ?? user?.email?.[0] ?? 'A').toUpperCase();
  const display = user?.name ?? user?.email?.split('@')[0] ?? 'Admin';
  const webhookStats = useFetch(
    () => user ? api.webhookEvents.stats(24) : Promise.resolve(null),
    [user?.id],
  );
  const webhookBadge = (webhookStats.data?.failed ?? 0) + (webhookStats.data?.exhausted ?? 0);

  const isActive = (href: string): boolean =>
    pathname === href || pathname.startsWith(href + '/');

  return (
    <aside style={{
      width: 224, flexShrink: 0,
      background: 'var(--bg)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      padding: '18px 14px',
      height: '100vh', position: 'sticky', top: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 6px 18px', borderBottom: '1px solid var(--border)' }}>
        <AceLogo size={20} />
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, letterSpacing: -0.2 }}>AcePay</div>
          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: -1, letterSpacing: 0.3, textTransform: 'uppercase' }}>Admin · live</div>
        </div>
      </div>

      <nav style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {NAV.map(n => {
          const active = isActive(n.href);
          return (
            <Link
              key={n.id}
              href={n.href}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 9px', borderRadius: 6,
                background: active ? 'var(--surface)' : 'transparent',
                border: '1px solid', borderColor: active ? 'var(--border)' : 'transparent',
                boxShadow: active ? 'var(--shadow-1)' : 'none',
                color: active ? 'var(--ink)' : 'var(--ink-2)',
                fontSize: 12.5, fontWeight: active ? 550 : 450,
                textDecoration: 'none',
                transition: 'all 120ms',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(0,0,0,0.025)'; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; }}
            >
              <Icon name={n.icon} size={14} color={active ? 'var(--accent)' : 'var(--muted)'} />
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.id === 'webhooks' && webhookBadge > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 600, color: 'var(--bad)',
                  background: 'var(--bad-soft)', padding: '1px 5px', borderRadius: 4,
                }}>{webhookBadge}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div style={{ marginTop: 'auto', paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '4px 6px',
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%',
            background: 'linear-gradient(135deg, #2A3556, #1E2A4A)',
            color: '#fff', fontWeight: 600, fontSize: 11.5,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{initial}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 550, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{display}</div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{user?.email ? 'Admin' : 'Sole admin'}</div>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            style={{ background: 'none', border: 'none', padding: 4, color: 'var(--muted)', cursor: 'pointer' }}
          >
            <Icon name="ext" size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
}

type SearchProps = {
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  width?: number;
};

export function Topbar({ title, breadcrumbs, search, actions }: {
  title: ReactNode;
  breadcrumbs?: Crumb[];
  search?: SearchProps;
  actions?: ReactNode;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const notifStats = useFetch(
    () => user ? api.notifications.stats() : Promise.resolve(null),
    [user?.id],
  );
  const criticalCount = notifStats.data?.critical ?? 0;
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 28px', borderBottom: '1px solid var(--border)',
      background: 'var(--bg)',
      position: 'sticky', top: 0, zIndex: 5,
      gap: 16,
    }}>
      <div style={{ minWidth: 0 }}>
        {breadcrumbs && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 }}>
            {breadcrumbs.map((b, i) => (
              <React.Fragment key={i}>
                {i > 0 && <Icon name="chevron" size={11} color="var(--muted-2)" />}
                <span style={{ cursor: b.onClick ? 'pointer' : 'default' }} onClick={b.onClick}>{b.label}</span>
              </React.Fragment>
            ))}
          </div>
        )}
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: -0.3, color: 'var(--ink)' }}>{title}</h1>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {search && <SearchInput {...search} />}
        <button
          aria-label="Notifications"
          onClick={() => router.push('/notifications')}
          style={{
            width: 30, height: 30, borderRadius: 6,
            border: '1px solid var(--border)', background: 'var(--surface)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
            cursor: 'pointer',
          }}
        >
          <Icon name="bell" size={14} color="var(--ink-2)" />
          {criticalCount > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -4,
              minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
              background: 'var(--bad)', color: '#fff',
              fontSize: 10, fontWeight: 700, lineHeight: '16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid var(--bg)',
            }}>{criticalCount > 99 ? '99+' : criticalCount}</span>
          )}
        </button>
        {actions}
      </div>
    </header>
  );
}

export function PageShell({ title, breadcrumbs, search, actions, children, gutter = 28 }: {
  title: ReactNode;
  breadcrumbs?: Crumb[];
  search?: SearchProps;
  actions?: ReactNode;
  children: ReactNode;
  gutter?: number;
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Topbar title={title} breadcrumbs={breadcrumbs} search={search} actions={actions} />
      <main style={{ padding: gutter, flex: 1, overflow: 'auto' }}>
        {children}
      </main>
    </div>
  );
}

export function Tabs({ tabs, current, onChange }: {
  tabs: { id: string; label: string; count?: number }[];
  current: string;
  onChange: (id: string) => void;
}) {
  return (
    <div style={{
      display: 'flex', gap: 2, borderBottom: '1px solid var(--border)',
      marginBottom: 18,
    }}>
      {tabs.map(t => {
        const active = current === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              padding: '8px 12px', marginBottom: -1,
              background: 'none', border: 'none',
              borderBottom: '2px solid', borderColor: active ? 'var(--accent)' : 'transparent',
              color: active ? 'var(--ink)' : 'var(--muted)',
              fontSize: 12.5, fontWeight: 550,
              cursor: 'pointer',
            }}
          >
            {t.label}
            {t.count != null && (
              <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted-2)' }}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
