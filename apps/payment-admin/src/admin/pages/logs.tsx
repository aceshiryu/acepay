'use client';

import React, { ReactNode } from 'react';
import * as api from '../api/client';
import { actionIcon, formatTime } from '../api/format';
import { LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { TransactionLog } from '../api/types';
import { PageShell } from '../layout';
import { Button, Card, FilterSelect, Icon, AppAvatar } from '../primitives';
import { Navigate, RoutePage } from '../types';

const PAGE_SIZE = 50;

export function ActivityLogsPage({ onNavigate }: { onNavigate: Navigate }) {
  const [appFilter, setAppFilter] = React.useState('All');
  const [actionFilter, setActionFilter] = React.useState('All');
  const [actorFilter, setActorFilter] = React.useState('All');
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);

  const apps = useFetch(() => api.apps.list(), []);
  const query: api.LogsListQuery = {
    page, pageSize: PAGE_SIZE,
    appId: appFilter !== 'All' ? appFilter : undefined,
    actor: actorFilter !== 'All' ? actorFilter.toLowerCase() : undefined,
    actionPrefix: actionFilter !== 'All' ? actionFilter.replace('.*', '.') : undefined,
    search: search || undefined,
  };
  const list = useFetch(() => api.logs.list(query), [JSON.stringify(query)]);

  const appOptions = ['All', ...(apps.data?.data ?? []).map((a) => ({ value: a.id, label: a.name }))];

  return (
    <PageShell
      title="Activity Logs"
      breadcrumbs={[{ label: 'Observability' }, { label: 'Activity Logs' }]}
      search={{ value: search, onChange: (v) => { setSearch(v); setPage(1); }, placeholder: 'Search action, tx id, provider event id…', width: 280 }}
      actions={
        <>
          <Button variant="secondary" size="md" leading={<Icon name="refresh" size={12} />} onClick={() => list.refetch()}>
            Refresh
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <Icon name="filter" size={13} color="var(--muted)" />
        <FilterSelect label="App"         value={appFilter}    onChange={(v) => { setAppFilter(v); setPage(1); }}    options={appOptions} />
        <FilterSelect label="Action type" value={actionFilter} onChange={(v) => { setActionFilter(v); setPage(1); }} options={['All', 'payment.*', 'subscription.*', 'refund.*', 'webhook.*']} />
        <FilterSelect label="Actor"       value={actorFilter}  onChange={(v) => { setActorFilter(v); setPage(1); }}  options={['All', 'App', 'System', 'Provider', 'Admin']} />
        <div style={{ flex: 1 }} />
        {list.data && (
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{list.data.total} events</span>
        )}
      </div>

      <Card padding={0}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '92px 22px 1fr 110px 130px 110px',
          gap: 12, padding: '10px 18px',
          fontSize: 11, fontWeight: 600, color: 'var(--muted)',
          textTransform: 'uppercase', letterSpacing: 0.4,
          background: 'var(--surface-2)',
          borderBottom: '1px solid var(--border)',
        }}>
          <span>Time</span><span /><span>Action</span><span>Ref</span><span>App</span><span>Actor</span>
        </div>

        {list.loading && <LoadingBlock height={300} />}
        {list.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{list.error.message}</div>}
        {list.data && (
          <>
            <TimeGroup label={`Recent · ${list.data.total} total`}>
              {list.data.data.map((row) => (
                <ActivityLogRow key={row.id} row={row} onTxClick={() => {
                  const dest: RoutePage = 'transaction-detail';
                  onNavigate(dest, row.transactionId);
                }} />
              ))}
              {list.data.data.length === 0 && (
                <div style={{ padding: 16, color: 'var(--muted)', fontSize: 12 }}>No events match your filters.</div>
              )}
            </TimeGroup>
            <Pager total={list.data.total} page={list.data.page} pageSize={list.data.pageSize} onChange={setPage} />
          </>
        )}
      </Card>
    </PageShell>
  );
}

function TimeGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{
        padding: '8px 18px', fontSize: 10.5, fontWeight: 600,
        color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5,
        background: 'var(--surface-2)',
        borderBottom: '1px solid var(--hairline)',
      }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function ActivityLogRow({ row, onTxClick }: { row: TransactionLog; onTxClick: () => void }) {
  const icon = actionIcon(row.action);
  const iconColorMap: Record<string, { fg: string; bg: string }> = {
    '✓': { fg: 'var(--ok)',     bg: 'var(--ok-soft)' },
    '+': { fg: 'var(--info)',   bg: 'var(--info-soft)' },
    '↑': { fg: 'var(--muted)',  bg: 'var(--neutral-soft)' },
    '↓': { fg: 'var(--muted)',  bg: 'var(--neutral-soft)' },
    '↻': { fg: '#5851B0',       bg: '#EBE7F4' },
    '⚠': { fg: 'var(--warn)',   bg: 'var(--warn-soft)' },
    '☠': { fg: 'var(--bad)',    bg: 'var(--bad-soft)' },
  };
  const c = iconColorMap[icon] || iconColorMap['+'];
  const appName = row.app?.name ?? '—';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '92px 22px 1fr 110px 130px 110px',
      gap: 12, alignItems: 'center',
      padding: '8px 18px',
      borderBottom: '1px solid var(--hairline)',
      fontSize: 12, transition: 'background 100ms',
    }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
    >
      <span className="mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{formatTime(row.createdAt)}</span>
      <span style={{
        width: 18, height: 18, borderRadius: 4,
        background: c.bg,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700,
        color: c.fg,
      }}>{icon}</span>
      <span className="mono" style={{ color: 'var(--ink)', fontSize: 12, fontWeight: 500 }}>{row.action}</span>
      <button
        className="mono"
        onClick={onTxClick}
        style={{
          background: 'none', border: 'none', padding: 0, fontSize: 11.5,
          color: 'var(--accent)', textAlign: 'left', cursor: 'pointer', fontWeight: 500,
        }}
      >{row.transactionId.slice(0, 8)}…</button>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-2)' }}>
        <AppAvatar name={appName} size={14} />{appName}
      </span>
      <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{row.actor}</span>
    </div>
  );
}

function Pager({ total, page, pageSize, onChange }: { total: number; page: number; pageSize: number; onChange: (p: number) => void }) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 16px', borderTop: '1px solid var(--hairline)',
      fontSize: 12, color: 'var(--muted)',
    }}>
      <span>Showing {start}–{end} of {total}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button disabled={page <= 1} onClick={() => onChange(Math.max(1, page - 1))}
          style={{ padding: '4px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11.5 }}
        >← Prev</button>
        <span style={{ fontSize: 11.5 }}>{page} of {last}</span>
        <button disabled={page >= last} onClick={() => onChange(Math.min(last, page + 1))}
          style={{ padding: '4px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11.5 }}
        >Next →</button>
      </div>
    </div>
  );
}
