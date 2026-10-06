'use client';

import React from 'react';
import * as api from '../api/client';
import { actionIcon, formatAmountCompact, formatRelative, formatTime, pickPrimary } from '../api/format';
import { GuardedView, LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { ProviderHealth, TransactionLog } from '../api/types';
import { PageShell } from '../layout';
import { Button, Card, GatewayCard, HeaderPill, Icon } from '../primitives';
import { AppCard } from '../app-card';
import { MiniStatCard, StatCard } from '../shared';
import { Navigate } from '../types';

export function DashboardPage({ onNavigate }: { onNavigate: Navigate }) {
  const dashboard = useFetch(() => api.stats.dashboard(), []);
  const providers = useFetch(() => api.stats.providers(), []);
  const activity = useFetch(() => api.logs.list({ pageSize: 10 }), []);
  const apps = useFetch(() => api.apps.list(), []);

  const [timeStr, setTimeStr] = React.useState<string>('');
  React.useEffect(() => {
    const tick = () => setTimeStr(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <PageShell
      title="Dashboard"
      actions={
        <>
          <Button variant="secondary" size="md" leading={<Icon name="refresh" size={12} />}
            onClick={() => { dashboard.refetch(); providers.refetch(); activity.refetch(); apps.refetch(); }}>
            Refresh
          </Button>
          <Button variant="primary" size="md" leading={<Icon name="plus" size={12} strokeWidth={2.4} />}
            onClick={() => onNavigate('register-app')}>
            Register App
          </Button>
        </>
      }
    >
      <div style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        marginBottom: 22,
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', letterSpacing: -0.4, lineHeight: 1.2 }}>
            Good {greetingForHour(new Date().getHours())} 👋
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            {dashboard.data
              ? `${dashboard.data.activeApps} apps processing · `
              : ''}
            <span className="mono">{timeStr || '—'}</span> local
          </div>
        </div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '5px 11px 5px 9px', borderRadius: 999,
          background: 'var(--surface)', border: '1px solid var(--border)',
          fontSize: 11.5, color: 'var(--muted)', fontWeight: 500,
        }}>
          <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: 6, background: 'var(--ok)' }} />
          Live
        </div>
      </div>

      <GuardedView
        state={dashboard}
        height={140}
        render={(d) => {
          const revenue = pickPrimary(d.revenueToday);
          const week = pickPrimary(d.thisWeekVolume);
          const month = pickPrimary(d.thisMonthVolume);
          return (
            <>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16, marginBottom: 16,
              }}>
                <StatCard
                  label="Transactions Today" value={d.transactionsToday}
                  sub="vs. yesterday" accent="#4F7CF7" icon="tx"
                  sparkData={trickle(d.transactionsToday)} big
                />
                <StatCard
                  label="Revenue Processed"
                  value={revenue ? formatAmountCompact(revenue.amount, revenue.currency) : '—'}
                  sub="net of refunds" accent="#1FB563" icon="wallet"
                  sparkData={trickle(revenue?.amount ?? 0)} big
                />
                <StatCard
                  label="Success Rate"
                  value={d.successRate != null ? `${d.successRate}%` : '—'}
                  sub={`${d.failedWebhooksPending > 0 ? d.failedWebhooksPending + ' webhooks pending' : 'all clear'}`}
                  accent="#0EA5E9" icon="check"
                  sparkData={trickle(d.successRate ?? 0)} big
                />
                <StatCard
                  label="Active Subscriptions" value={d.activeSubscriptions}
                  sub="recurring" accent="#7C5CF5" icon="sub"
                  sparkData={trickle(d.activeSubscriptions)} big
                />
              </div>

              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16, marginBottom: 24,
              }}>
                <MiniStatCard
                  label="This Week"
                  value={week ? formatAmountCompact(week.amount, week.currency) : '—'}
                  sub={`Across all apps`}
                />
                <MiniStatCard
                  label="This Month"
                  value={month ? formatAmountCompact(month.amount, month.currency) : '—'}
                  sub={`Across all apps`}
                />
                <MiniStatCard
                  label="Failed Webhooks Pending"
                  value={d.failedWebhooksPending}
                  sub="Tap to review"
                  warning={d.failedWebhooksPending > 0}
                  onClick={() => onNavigate('webhooks')}
                />
              </div>
            </>
          );
        }}
      />

      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 16, marginBottom: 28,
      }}>
        <Card
          title="Recent Activity"
          subtitle="Live feed · latest events across all apps"
          action={
            <button onClick={() => onNavigate('logs')} style={linkBtn}>
              View all activity <Icon name="arrow" size={11} strokeWidth={2} />
            </button>
          }
        >
          <div style={{ padding: '0 4px 8px' }}>
            {activity.loading && <div style={{ padding: 16, color: 'var(--muted-2)', fontSize: 12 }}>Loading…</div>}
            {activity.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{activity.error.message}</div>}
            {activity.data?.data.map((row) => (
              <DashboardActivityRow key={row.id} row={row} onTxClick={() => onNavigate('transaction-detail', row.transactionId)} />
            ))}
            {activity.data && activity.data.data.length === 0 && (
              <div style={{ padding: 16, color: 'var(--muted)', fontSize: 12 }}>No activity yet.</div>
            )}
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 15, fontWeight: 650 }}>Providers</div>
            <button onClick={() => onNavigate('gateways')} style={linkBtn}>
              All gateways <Icon name="arrow" size={11} strokeWidth={2} />
            </button>
          </div>
          {providers.loading && <LoadingBlock height={140} />}
          {providers.error && <div style={{ color: 'var(--bad)', fontSize: 12 }}>{providers.error.message}</div>}
          {providers.data?.providers.map((p) => (
            <ProviderCard key={p.name} provider={p} onClick={() => onNavigate('gateways')} />
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>My apps</div>
        <button onClick={() => onNavigate('apps')} style={linkBtn}>
          View all apps <Icon name="arrow" size={11} strokeWidth={2} />
        </button>
      </div>
      {apps.loading && <LoadingBlock height={120} />}
      {apps.error && <div style={{ color: 'var(--bad)', fontSize: 12 }}>{apps.error.message}</div>}
      {apps.data && apps.data.data.length === 0 && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          No apps registered yet. <button onClick={() => onNavigate('register-app')} style={linkBtn}>Register one →</button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
        {apps.data?.data.filter((a) => a.isActive).map((app) => (
          <AppCard key={app.id} app={app} onNavigate={onNavigate} compact />
        ))}
      </div>
    </PageShell>
  );
}

function greetingForHour(h: number): string {
  if (h < 5) return 'evening, Ace';
  if (h < 12) return 'morning, Ace';
  if (h < 17) return 'afternoon, Ace';
  return 'evening, Ace';
}

// Synthetic sparkline data based on a value, since the gateway doesn't return time series yet.
function trickle(value: number): number[] {
  const n = 12;
  const arr: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = (i + 1) / n;
    arr.push(Math.max(1, Math.round(value * f)));
  }
  return arr;
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, fontSize: 12.5, color: 'var(--accent)',
  display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600, cursor: 'pointer',
};

function ProviderCard({ provider, onClick }: { provider: ProviderHealth; onClick: () => void }) {
  const statusInfo = {
    ok:   { dot: 'var(--ok)',   label: 'Healthy' },
    warn: { dot: 'var(--warn)', label: 'Degraded' },
    bad:  { dot: 'var(--bad)',  label: 'Down' },
  }[provider.status];
  const isXendit = provider.name === 'xendit';
  return (
    <GatewayCard
      compact
      color={isXendit ? 'var(--brand-xendit)' : 'var(--brand-lemon)'}
      icon={<Icon name={isXendit ? 'wallet' : 'card'} size={16} color="#fff" strokeWidth={2} />}
      title={isXendit ? 'Xendit' : 'Lemon Squeezy'}
      badge={<HeaderPill dot={statusInfo.dot}>{statusInfo.label}</HeaderPill>}
      rows={[
        { label: 'Region', value: isXendit ? 'Philippines' : 'Global' },
        { label: 'Last webhook', value: formatRelative(provider.lastWebhookAt) },
      ]}
      onClick={onClick}
    />
  );
}

function DashboardActivityRow({ row, onTxClick }: { row: TransactionLog; onTxClick?: () => void }) {
  const icon = actionIcon(row.action);
  const iconColorMap: Record<string, string> = {
    '✓': 'var(--ok)', '+': 'var(--info)', '↑': 'var(--muted)', '↓': 'var(--muted)',
    '↻': '#5851B0', '⚠': 'var(--warn)', '☠': 'var(--bad)',
  };
  const appName = row.app?.name ?? '—';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '70px 22px minmax(0,1fr) 90px 80px 110px',
      gap: 12, alignItems: 'center',
      padding: '8px 12px',
      borderRadius: 6, fontSize: 12,
    }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={e => (e.currentTarget.style.background = '')}
    >
      <span className="mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{formatTime(row.createdAt)}</span>
      <span style={{
        width: 20, height: 20, borderRadius: 6, background: 'var(--surface-2)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 600, color: iconColorMap[icon] ?? 'var(--muted)',
        border: '1px solid var(--border)',
      }}>{icon}</span>
      <span className="mono" style={{ color: 'var(--ink)', fontSize: 11.5, fontWeight: 500 }}>{row.action}</span>
      <button
        className="mono"
        onClick={(e) => { e.stopPropagation(); onTxClick && onTxClick(); }}
        style={{
          background: 'none', border: 'none', padding: 0, fontSize: 11.5,
          color: 'var(--accent)', textAlign: 'left', cursor: 'pointer', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >{row.transaction?.code ?? '—'}</button>
      <span style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 500 }}>{appName}</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>{row.actor}</span>
    </div>
  );
}
