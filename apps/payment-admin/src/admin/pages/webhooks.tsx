'use client';

import React from 'react';
import * as api from '../api/client';
import { formatDateTime, formatRelative } from '../api/format';
import { GuardedView, LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { WebhookEvent } from '../api/types';
import { PageShell, Tabs } from '../layout';
import { Button, Card, FilterSelect, Icon, KV, ProviderTag, StatusBadge, Table, AppAvatar } from '../primitives';
import { CodeBlock, DetailMicro, MiniStatCard } from '../shared';
import { Navigate } from '../types';

const PAGE_SIZE = 20;

export function WebhooksPage({ onNavigate }: { onNavigate: Navigate; initialStatus?: string }) {
  const [appFilter, setAppFilter] = React.useState('All');
  const [providerFilter, setProviderFilter] = React.useState('All');
  const [statusFilter, setStatusFilter] = React.useState('All');
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);

  const apps = useFetch(() => api.apps.list(), []);
  const stats = useFetch(() => api.webhookEvents.stats(24), []);
  const query: api.WebhookListQuery = {
    page, pageSize: PAGE_SIZE,
    appId: appFilter !== 'All' ? appFilter : undefined,
    provider: providerFilter !== 'All' ? providerFilter.toLowerCase() : undefined,
    deliveryStatus: statusFilter !== 'All' ? statusFilter.toLowerCase() : undefined,
    search: search || undefined,
  };
  const list = useFetch(() => api.webhookEvents.list(query), [JSON.stringify(query)]);

  const appOptions = ['All', ...(apps.data?.data ?? []).map((a) => ({ value: a.id, label: a.name }))];

  return (
    <PageShell
      title="Webhook Events"
      breadcrumbs={[{ label: 'Operations' }, { label: 'Webhook Events' }]}
      search={{ value: search, onChange: (v) => { setSearch(v); setPage(1); }, placeholder: 'Search event code, type, transaction…', width: 280 }}
    >
      <GuardedView
        state={stats}
        height={70}
        render={(s) => (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 18 }}>
            <MiniStatCard label={`Delivered (${s.windowHours}h)`} value={s.deliveredInWindow} sub="success" />
            <MiniStatCard label="Pending" value={s.pending} sub="in flight" />
            <MiniStatCard label="Failed" value={s.failed} sub="will retry" warning={s.failed > 0} />
            <MiniStatCard label="Exhausted" value={s.exhausted} sub="needs manual retry" warning={s.exhausted > 0} />
            <MiniStatCard label="Avg Delivery" value={s.avgDeliveryMs ? `${(s.avgDeliveryMs / 1000).toFixed(1)}s` : '—'} sub="end-to-end" />
          </div>
        )}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <Icon name="filter" size={13} color="var(--muted)" />
        <FilterSelect label="App"      value={appFilter}      onChange={(v) => { setAppFilter(v); setPage(1); }}      options={appOptions} />
        <FilterSelect label="Provider" value={providerFilter} onChange={(v) => { setProviderFilter(v); setPage(1); }} options={['All', { value: 'lemonsqueezy', label: 'Lemon Squeezy' }, 'Xendit']} />
        <FilterSelect label="Delivery" value={statusFilter}   onChange={(v) => { setStatusFilter(v); setPage(1); }}   options={['All', 'Pending', 'Delivered', 'Failed', 'Exhausted']} />
        <div style={{ flex: 1 }} />
        {list.data && (
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{list.data.total} total</span>
        )}
      </div>

      <Card padding={0}>
        {list.loading && <LoadingBlock height={200} />}
        {list.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{list.error.message}</div>}
        {list.data && (
          <>
            <Table<WebhookEvent>
              columns={[
                { key: 'id', label: 'Event ID', render: (r) => <span className="mono" style={{ color: 'var(--accent)', fontWeight: 500 }}>{r.code}</span> },
                { key: 'app', label: 'App', render: (r) => (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <AppAvatar name={r.app?.name ?? '?'} size={18} />{r.app?.name ?? '—'}
                  </span>
                )},
                { key: 'tx', label: 'Transaction', render: (r) => r.transactionId
                  ? <span className="mono" style={{ color: 'var(--accent)' }}>{r.transaction?.code ?? '—'}</span>
                  : '—' },
                { key: 'provider', label: 'Provider', render: (r) => <ProviderTag name={r.provider} size="sm" /> },
                { key: 'type', label: 'Event Type', render: (r) => <span className="mono" style={{ color: 'var(--ink-2)' }}>{r.eventType}</span> },
                { key: 'attempts', label: 'Attempts', align: 'center', render: (r) => (
                  <span className="mono" style={{ fontSize: 11.5, color: r.attempts >= r.maxAttempts ? 'var(--bad)' : 'var(--muted)' }}>{r.attempts}/{r.maxAttempts}</span>
                )},
                { key: 'status', label: 'Delivery', render: (r) => <StatusBadge status={r.deliveryStatus} size="sm" /> },
                { key: 'received', label: 'Received', align: 'right', render: (r) => <span className="mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{formatRelative(r.createdAt)}</span> },
                { key: 'delivered', label: 'Delivered', align: 'right', render: (r) => <span className="mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{r.deliveredAt ? formatRelative(r.deliveredAt) : '—'}</span> },
              ]}
              rows={list.data.data}
              getRowKey={(r) => r.id}
              onRowClick={(r) => onNavigate('webhook-detail', r.id)}
            />
            <Pager total={list.data.total} page={list.data.page} pageSize={list.data.pageSize} onChange={setPage} />
          </>
        )}
      </Card>
    </PageShell>
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

// ─── Webhook Detail ─────────────────────────────────────────────────────

export function WebhookDetailPage({ evtId, onNavigate, onBack }: { evtId: string | null; onNavigate: Navigate; onBack: () => void }) {
  const evtQ = useFetch(() => api.webhookEvents.one(evtId!), [evtId]);
  const [tab, setTab] = React.useState('attempt');

  if (evtQ.loading || !evtQ.data) {
    return (
      <PageShell title="Webhook Event" breadcrumbs={[{ label: 'Webhook Events', onClick: onBack }, { label: '…' }]}>
        <LoadingBlock height={200} />
      </PageShell>
    );
  }
  if (evtQ.error) {
    return (
      <PageShell title="Webhook Event" breadcrumbs={[{ label: 'Webhook Events', onClick: onBack }]}>
        <div style={{ padding: 16, color: 'var(--bad)' }}>{evtQ.error.message}</div>
      </PageShell>
    );
  }
  const evt = evtQ.data;

  return (
    <PageShell
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <span className="mono" style={{ fontSize: 19 }}>{evt.code}</span>
          <StatusBadge status={evt.deliveryStatus} />
        </span>
      }
      breadcrumbs={[{ label: 'Webhook Events', onClick: onBack }, { label: evt.code }]}
      actions={
        <>
          <Button variant="secondary" size="md" leading={<Icon name="copy" size={12} />}
            onClick={() => navigator.clipboard?.writeText(evt.code)}>Copy code</Button>
          <Button variant="primary" size="md" leading={<Icon name="refresh" size={12} />}
            onClick={async () => { await api.webhookEvents.retry(evt.id); evtQ.refetch(); }}>
            Retry Now
          </Button>
        </>
      }
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '18px 22px',
        boxShadow: 'var(--shadow-1)', marginBottom: 16,
        display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16,
      }}>
        <DetailMicro label="Event Type" value={<span className="mono" style={{ fontSize: 13 }}>{evt.eventType}</span>} />
        <DetailMicro label="App" value={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><AppAvatar name={evt.app?.name ?? '?'} size={16} />{evt.app?.name ?? '—'}</span>} />
        <DetailMicro label="Transaction" value={evt.transactionId ?
          <span className="mono" style={{ color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }} onClick={() => onNavigate('transaction-detail', evt.transactionId!)}>
            {evt.transaction?.code ?? '—'}
          </span> : '—'} />
        <DetailMicro label="Provider" value={<ProviderTag name={evt.provider} size="sm" />} />
        <DetailMicro label="Attempts" value={
          <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: evt.attempts >= evt.maxAttempts ? 'var(--bad)' : 'var(--ink)' }}>
            {evt.attempts}/{evt.maxAttempts}
          </span>
        } />
        <DetailMicro label="Next Retry" value={<span className="mono" style={{ fontSize: 12 }}>{evt.nextRetryAt ? formatDateTime(evt.nextRetryAt) : '—'}</span>} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16 }}>
        <Card title="Identification" padding={0}>
          <div style={{ padding: '4px 16px 14px' }}>
            <KV k="Event code" v={<span className="mono">{evt.code}</span>} />
            <KV k="Provider Event ID" v={<span className="mono">{evt.providerEventId}</span>} mono />
            <KV k="Event Type" v={<span className="mono">{evt.eventType}</span>} />
            <KV k="Received At" v={formatDateTime(evt.createdAt)} />
            <KV k="Delivered At" v={evt.deliveredAt ? formatDateTime(evt.deliveredAt) : '—'} />
            <KV k="Last Status" v={evt.lastResponseStatus != null ? String(evt.lastResponseStatus) : '—'} />
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Card padding={0}>
            <Tabs
              current={tab}
              onChange={setTab}
              tabs={[
                { id: 'attempt', label: 'Last Response', count: evt.attempts },
                { id: 'raw', label: 'Raw Provider Payload' },
                { id: 'normalized', label: 'Normalized Payload' },
              ]}
            />
            {tab === 'attempt' && (
              <div style={{ padding: 16 }}>
                {evt.lastResponseStatus != null ? (
                  <>
                    <div style={{ marginBottom: 8 }}>
                      <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{evt.lastResponseStatus}</span>
                    </div>
                    <CodeBlock>{evt.lastResponseBody ?? '(empty body)'}</CodeBlock>
                  </>
                ) : (
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>No attempts yet.</div>
                )}
              </div>
            )}
            {tab === 'raw' && (
              <CodeBlock>{JSON.stringify(evt.providerPayload, null, 2)}</CodeBlock>
            )}
            {tab === 'normalized' && (
              <CodeBlock>{JSON.stringify(evt.normalizedPayload ?? {}, null, 2)}</CodeBlock>
            )}
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
