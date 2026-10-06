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
      width: 232, flexShrink: 0,
      background: 'var(--surface)',
      borderRight: '1px solid var(--hairline)',
      display: 'flex', flexDirection: 'column',
      padding: '18px 14px 12px',
      height: '100vh', position: 'sticky', top: 0, zIndex: 20,
      overflowY: 'auto',
    }}>
      <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 6px', marginBottom: 18 }}>
        <AceLogo size={22} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.3 }}>AcePay</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: -1 }}>Payment gateway admin</div>
        </div>
      </Link>

      <nav className="rail-nav" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        {NAV.map((n, i) => {
          const active = isActive(n.href);
          const newGroup = i === 0 || NAV[i - 1].group !== n.group;
          return (
            <React.Fragment key={n.id}>
              {newGroup && (
                <div className="nav-group" style={{
                  fontSize: 10.5, fontWeight: 650, color: 'var(--muted-2)',
                  textTransform: 'uppercase', letterSpacing: 0.7, padding: '0 8px',
                }}>{GROUP_LABELS[n.group] ?? n.group}</div>
              )}
              <Link
                href={n.href}
                className="nav-link"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '5px 8px', borderRadius: 10,
                  background: active ? `${n.tint}14` : undefined,
                  color: active ? 'var(--ink)' : 'var(--ink-2)',
                  fontSize: 13, fontWeight: active ? 650 : 500,
                  transition: 'background 120ms',
                }}
              >
                <span className="nav-icon" style={{
                  borderRadius: 9, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: active ? n.tint : `${n.tint}14`,
                  boxShadow: active ? `0 4px 10px -4px ${n.tint}` : 'none',
                }}>
                  <Icon name={n.icon} size={15} strokeWidth={1.9} color={active ? '#fff' : n.tint} />
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</span>
                {n.id === 'webhooks' && webhookBadge > 0 && (
                  <span style={{
                    minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                    background: 'var(--bad)', color: '#fff',
                    fontSize: 10, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{webhookBadge > 99 ? '99+' : webhookBadge}</span>
                )}
              </Link>
            </React.Fragment>
          );
        })}
      </nav>

      <div style={{
        marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--hairline)',
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 6px 0',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, #6C8CFF, #4F7CF7)',
          color: '#fff', fontWeight: 700, fontSize: 13,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{initial}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{display}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Admin</div>
        </div>
        <button
          onClick={logout}
          title="Sign out"
          aria-label="Sign out"
          style={{ background: 'none', border: 'none', padding: 6, color: 'var(--muted)', cursor: 'pointer' }}
        >
          <Icon name="ext" size={15} />
        </button>
      </div>
    </aside>
  );
}

const GROUP_LABELS: Record<string, string> = {
  overview: 'Overview',
  billing: 'Billing',
  marketplace: 'Marketplace',
  system: 'System',
};

type SearchProps = {
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  width?: number;
};

export function Topbar({ title, subtitle, breadcrumbs, search, actions }: {
  title: ReactNode;
  subtitle?: ReactNode;
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
    <header className="page-top" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '22px 32px 14px',
      background: 'var(--bg)',
      position: 'sticky', top: 0, zIndex: 5,
      gap: 16, flexWrap: 'wrap',
      maxWidth: 1344, width: '100%', margin: '0 auto',
    }}>
      <div style={{ minWidth: 0, flex: '1 1 340px' }}>
        {breadcrumbs && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>
            {breadcrumbs.map((b, i) => (
              <React.Fragment key={i}>
                {i > 0 && <Icon name="chevron" size={11} color="var(--muted-2)" />}
                <span style={{ cursor: b.onClick ? 'pointer' : 'default' }} onClick={b.onClick}>{b.label}</span>
              </React.Fragment>
            ))}
          </div>
        )}
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: -0.6, color: 'var(--ink)', lineHeight: 1.2 }}>{title}</h1>
        {subtitle && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{subtitle}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
        {search && <SearchInput {...search} />}
        <button
          aria-label="Notifications"
          onClick={() => router.push('/notifications')}
          style={{
            width: 36, height: 36, borderRadius: 10,
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

export function PageShell({ title, subtitle, breadcrumbs, search, actions, children, gutter = 32 }: {
  title: ReactNode;
  subtitle?: ReactNode;
  breadcrumbs?: Crumb[];
  search?: SearchProps;
  actions?: ReactNode;
  children: ReactNode;
  gutter?: number;
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Topbar title={title} subtitle={subtitle} breadcrumbs={breadcrumbs} search={search} actions={actions} />
      <main className="page-main" style={{ padding: `10px ${gutter}px ${gutter}px`, flex: 1, overflow: 'auto', maxWidth: 1344, width: '100%', margin: '0 auto' }}>
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
