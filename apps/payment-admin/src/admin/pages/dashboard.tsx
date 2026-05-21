'use client';

import React from 'react';
import * as api from '../api/client';
import { actionIcon, formatAmountCompact, formatRelative, formatTime, pickPrimary } from '../api/format';
import { GuardedView, LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { AppView, ProviderHealth, TransactionLog } from '../api/types';
import { PageShell } from '../layout';
import { Button, Card, Icon, ProviderTag, Sparkline, AppAvatar } from '../primitives';
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
      breadcrumbs={[{ label: 'Overview' }, { label: 'Today' }]}
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
          <div className="serif" style={{ fontSize: 32, color: 'var(--ink)', letterSpacing: -0.6, lineHeight: 1.1 }}>
            Good {greetingForHour(new Date().getHours())}.
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
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14,
              }}>
                <StatCard
                  label="Transactions Today" value={d.transactionsToday}
                  sub="vs. yesterday" accent="var(--info)"
                  sparkData={trickle(d.transactionsToday)} big
                />
                <StatCard
                  label="Revenue Processed"
                  value={revenue ? formatAmountCompact(revenue.amount, revenue.currency) : '—'}
                  sub="net of refunds" accent="var(--ok)"
                  sparkData={trickle(revenue?.amount ?? 0)} big
                />
                <StatCard
                  label="Success Rate"
                  value={d.successRate != null ? `${d.successRate}%` : '—'}
                  sub={`${d.failedWebhooksPending > 0 ? d.failedWebhooksPending + ' webhooks pending' : 'all clear'}`}
                  accent="var(--ok)"
                  sparkData={trickle(d.successRate ?? 0)} big
                />
                <StatCard
                  label="Active Subscriptions" value={d.activeSubscriptions}
                  sub="recurring" accent="#5851B0"
                  sparkData={trickle(d.activeSubscriptions)} big
                />
              </div>

              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 22,
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
        display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14, marginBottom: 22,
      }}>
        <Card
          title="Recent Activity"
          subtitle="Live feed · latest events across all apps"
          action={
            <button onClick={() => onNavigate('logs')} style={{
              background: 'none', border: 'none', padding: 0, fontSize: 12, color: 'var(--accent)',
              display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 550, cursor: 'pointer',
            }}>
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Provider Status" subtitle="Webhook ingestion health">
            {providers.loading && <LoadingBlock height={70} />}
            {providers.error && <div style={{ padding: 14, color: 'var(--bad)', fontSize: 12 }}>{providers.error.message}</div>}
            {providers.data?.providers.map((p) => (
              <ProviderStatusRow key={p.name} provider={p} />
            ))}
            <div style={{
              padding: '10px 14px', fontSize: 11, color: 'var(--muted)',
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>Auto-check on load</span>
              <span style={{ color: providers.data?.providers.every((p) => p.status === 'ok') ? 'var(--ok)' : 'var(--warn)', fontWeight: 600 }}>
                {providers.data?.providers.every((p) => p.status === 'ok') ? 'All systems normal' : 'Check providers'}
              </span>
            </div>
          </Card>

          <Card title="Apps Snapshot" subtitle="All registered apps">
            <div style={{ padding: '6px 0' }}>
              {apps.loading && <LoadingBlock height={120} />}
              {apps.error && <div style={{ padding: 14, color: 'var(--bad)', fontSize: 12 }}>{apps.error.message}</div>}
              {apps.data?.data.filter((a) => a.isActive).map((app) => (
                <AppMiniRow key={app.id} app={app} onClick={() => onNavigate('app-detail', app.id)} />
              ))}
              {apps.data && apps.data.data.length === 0 && (
                <div style={{ padding: 14, color: 'var(--muted)', fontSize: 12 }}>
                  No apps registered. <button
                    onClick={() => onNavigate('register-app')}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer', fontWeight: 550 }}
                  >Register one →</button>
                </div>
              )}
            </div>
          </Card>
        </div>
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

function ProviderStatusRow({ provider }: { provider: ProviderHealth }) {
  const statusInfo = {
    ok:   { color: 'var(--ok)',   bg: 'var(--ok-soft)',   label: 'Healthy' },
    warn: { color: 'var(--warn)', bg: 'var(--warn-soft)', label: 'Degraded' },
    bad:  { color: 'var(--bad)',  bg: 'var(--bad-soft)',  label: 'Down' },
  }[provider.status];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '11px 14px', borderBottom: '1px solid var(--hairline)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ProviderTag name={provider.name} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          Last webhook {formatRelative(provider.lastWebhookAt)}
        </span>
      </div>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 11.5, color: statusInfo.color, fontWeight: 600,
        padding: '2px 8px', background: statusInfo.bg, borderRadius: 999,
      }}>
        <span className="pulse-dot" style={{ width: 5, height: 5, borderRadius: 5, background: statusInfo.color }} />
        {statusInfo.label}
      </span>
    </div>
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
      gridTemplateColumns: '78px 22px 1fr 110px 80px 130px',
      gap: 12, alignItems: 'center',
      padding: '8px 12px',
      borderRadius: 6, fontSize: 12,
    }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={e => (e.currentTarget.style.background = '')}
    >
      <span className="mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{formatTime(row.createdAt)}</span>
      <span style={{
        width: 18, height: 18, borderRadius: 4, background: 'var(--surface-2)',
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
      >{row.transactionId.slice(0, 8)}…</button>
      <span style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 500 }}>{appName}</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>{row.actor}</span>
    </div>
  );
}

function AppMiniRow({ app, onClick }: { app: AppView; onClick?: () => void }) {
  const summary = useFetch(() => api.stats.app(app.id), [app.id]);
  const today = summary.data?.txCount ?? 0;
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 14px', cursor: 'pointer',
      borderBottom: '1px solid var(--hairline)',
    }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={e => (e.currentTarget.style.background = '')}
    >
      <AppAvatar name={app.name} size={22} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 550, color: 'var(--ink)' }}>{app.name}</div>
        <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
          {summary.loading ? 'loading…' : `${today} tx total`}
        </div>
      </div>
      <Sparkline data={trickle(today || 5)} width={56} height={20} fill={false} color="var(--accent)" />
    </div>
  );
}
