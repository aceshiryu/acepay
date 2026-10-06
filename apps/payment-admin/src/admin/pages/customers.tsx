'use client';

import React from 'react';
import * as api from '../api/client';
import { formatRelative } from '../api/format';
import { GuardedView, LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { CustomerListRow } from '../api/types';
import { PageShell } from '../layout';
import { Card, FilterSelect, Icon, Table, AppAvatar } from '../primitives';
import { MiniStatCard } from '../shared';
import { Navigate } from '../types';

const PAGE_SIZE = 20;

export function CustomersPage({ onNavigate: _onNavigate }: { onNavigate: Navigate }) {
  const [appFilter, setAppFilter] = React.useState('All');
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);

  const apps = useFetch(() => api.apps.list(), []);
  const stats = useFetch(() => api.customers.stats(), []);
  const query: api.CustomerListQuery = {
    page, pageSize: PAGE_SIZE,
    appId: appFilter !== 'All' ? appFilter : undefined,
    search: search || undefined,
  };
  const list = useFetch(() => api.customers.list(query), [JSON.stringify(query)]);

  const appOptions = ['All', ...(apps.data?.data ?? []).map((a) => ({ value: a.id, label: a.name }))];

  return (
    <PageShell
      title="Customers"
      breadcrumbs={[{ label: 'Directory' }, { label: 'Customers' }]}
      search={{ value: search, onChange: (v) => { setSearch(v); setPage(1); }, placeholder: 'Search code, name, email, external id…', width: 280 }}
    >
      <GuardedView
        state={stats}
        height={70}
        render={(s) => (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
            <MiniStatCard label="Total Customers" value={s.total} sub="across all apps" />
            <MiniStatCard label="With Subscriptions" value={s.withSubscriptions} sub="active recurring" />
            <MiniStatCard label="Joined This Month" value={s.joinedThisMonth} sub="new" />
            <MiniStatCard
              label="Top App"
              value={s.topApp?.name ?? '—'}
              sub={s.topApp ? `${s.topApp.count} customers` : 'no customers yet'}
            />
          </div>
        )}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <Icon name="filter" size={13} color="var(--muted)" />
        <FilterSelect label="App" value={appFilter} onChange={(v) => { setAppFilter(v); setPage(1); }} options={appOptions} />
        <div style={{ flex: 1 }} />
        {list.data && (
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{list.data.total} customers</span>
        )}
      </div>

      <Card padding={0}>
        {list.loading && <LoadingBlock height={200} />}
        {list.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{list.error.message}</div>}
        {list.data && (
          <>
            <Table<CustomerListRow>
              columns={[
                { key: 'id', label: 'ID', render: (r) => <span className="mono" style={{ color: 'var(--accent)' }}>{r.customer.code}</span> },
                { key: 'app', label: 'App', render: (r) => (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <AppAvatar name={r.customer.app?.name ?? '?'} size={18} />{r.customer.app?.name ?? '—'}
                  </span>
                )},
                { key: 'name', label: 'Name', render: (r) => (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                    <CustomerAvatar name={r.customer.name ?? r.customer.email} />
                    <span style={{ fontWeight: 500 }}>{r.customer.name ?? '—'}</span>
                  </span>
                )},
                { key: 'email', label: 'Email', render: (r) => <span style={{ color: 'var(--ink-2)' }}>{r.customer.email}</span> },
                { key: 'externalId', label: 'External ID', render: (r) => <span className="mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{r.customer.externalId}</span> },
                { key: 'subs', label: 'Subs', align: 'right', render: (r) => <span className="mono" style={{ fontWeight: r.subscriptionsCount ? 600 : 400, color: r.subscriptionsCount ? 'var(--ink)' : 'var(--muted)' }}>{r.subscriptionsCount}</span> },
                { key: 'tx', label: 'TX', align: 'right', render: (r) => <span className="mono">{r.transactionsCount}</span> },
                { key: 'joined', label: 'Joined', align: 'right', render: (r) => <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{formatRelative(r.customer.createdAt)}</span> },
              ]}
              rows={list.data.data}
              getRowKey={(r) => r.customer.id}
            />
            <Pager total={list.data.total} page={list.data.page} pageSize={list.data.pageSize} onChange={setPage} />
          </>
        )}
      </Card>
    </PageShell>
  );
}

function CustomerAvatar({ name }: { name: string }) {
  const initials = name.split(' ').slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = (hash * 37) % 360;
  return (
    <span style={{
      width: 22, height: 22, borderRadius: '50%',
      background: `oklch(0.82 0.05 ${hue})`, color: `oklch(0.35 0.08 ${hue})`,
      fontSize: 10, fontWeight: 600,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, letterSpacing: 0.2,
    }}>{initials}</span>
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
