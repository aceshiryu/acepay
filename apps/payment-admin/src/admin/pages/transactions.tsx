'use client';

import React from 'react';
import * as api from '../api/client';
import {
  formatAmount, formatAmountCompact, formatDateTime, formatRelative,
} from '../api/format';
import { GuardedView, LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { Transaction, TransactionLog } from '../api/types';
import { PageShell } from '../layout';
import {
  Button, Card, FilterSelect, Icon, KV, ProviderTag, SourceTag, StatusBadge, Table, TypePill, AppAvatar,
} from '../primitives';
import {
  CodeBlock, CollapsibleCard, DetailMicro, MiniStatCard, Modal, MovementTimeline,
} from '../shared';
import { Navigate } from '../types';

type TxFilters = {
  search: string; appId: string; provider: string;
  type: string; status: string; source: string;
  page: number;
};

const PAGE_SIZE = 20;
const EMPTY: TxFilters = {
  search: '', appId: 'All', provider: 'All', type: 'All', status: 'All', source: 'All', page: 1,
};

export function TransactionsPage({ onNavigate, filterApp }: { onNavigate: Navigate; filterApp?: string | null }) {
  const [f, setF] = React.useState<TxFilters>({ ...EMPTY, appId: filterApp || 'All' });
  const set = <K extends keyof TxFilters>(k: K, v: TxFilters[K]) =>
    setF((prev) => ({ ...prev, [k]: v, page: k === 'page' ? (v as number) : 1 }));

  const apps = useFetch(() => api.apps.list(), []);
  const query: api.TxListQuery = {
    page: f.page, pageSize: PAGE_SIZE,
    search: f.search || undefined,
    appId: f.appId !== 'All' ? f.appId : undefined,
    provider: f.provider !== 'All' ? f.provider.toLowerCase() : undefined,
    type: f.type !== 'All' ? f.type.toLowerCase().replace(' ', '_') : undefined,
    status: f.status !== 'All' ? f.status.toLowerCase().replace(' ', '_') : undefined,
    source: f.source !== 'All' ? f.source.toLowerCase() : undefined,
  };
  const list = useFetch(() => api.transactions.list(query), [JSON.stringify(query)]);
  const stats = useFetch(() => api.transactions.stats(query), [JSON.stringify(query)]);

  const appOptions = ['All', ...(apps.data?.data ?? []).map((a) => ({ value: a.id, label: a.name }))];

  return (
    <PageShell
      title="Transactions"
      breadcrumbs={[{ label: 'Operations' }, { label: 'Transactions' }]}
      search={{
        value: f.search, onChange: (v) => set('search', v),
        placeholder: 'Search txn id, customer, email…', width: 280,
      }}
      actions={
        <Button variant="secondary" size="md" leading={<Icon name="download" size={12} />}>Export</Button>
      }
    >
      <GuardedView
        state={stats}
        height={70}
        render={(s) => (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
            <MiniStatCard label="Total (filtered)" value={s.total} sub="all-time" />
            <MiniStatCard label="Succeeded" value={s.succeeded} sub="this view" />
            <MiniStatCard label="Pending" value={s.pending} sub="awaiting webhook" />
            <MiniStatCard label="Failed" value={s.failed} sub="action may be needed" warning={s.failed > 0} />
          </div>
        )}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <Icon name="filter" size={13} color="var(--muted)" />
        <FilterSelect label="App"      value={f.appId}    onChange={(v) => set('appId', v)}    options={appOptions} />
        <FilterSelect label="Provider" value={f.provider} onChange={(v) => set('provider', v)} options={['All', { value: 'lemonsqueezy', label: 'Lemon Squeezy' }, 'Xendit']} />
        <FilterSelect label="Type"     value={f.type}     onChange={(v) => set('type', v)}     options={['All', 'Payment', 'Refund', 'Subscription payment']} />
        <FilterSelect label="Status"   value={f.status}   onChange={(v) => set('status', v)}   options={['All', 'Pending', 'Succeeded', 'Failed', 'Refunded']} />
        <FilterSelect label="Source"   value={f.source}   onChange={(v) => set('source', v)}   options={['All', 'Web', 'Mobile']} />
        <div style={{ flex: 1 }} />
        {list.data && (
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {list.data.total} total
          </span>
        )}
      </div>

      <Card padding={0}>
        {list.loading && <LoadingBlock height={200} />}
        {list.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{list.error.message}</div>}
        {list.data && (
          <>
            <Table<Transaction>
              columns={[
                { key: 'id', label: 'ID', render: (r) => <span className="mono" style={{ color: 'var(--accent)', fontWeight: 500 }}>{r.id.slice(0, 8)}…</span> },
                { key: 'app', label: 'App', render: (r) => (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <AppAvatar name={r.app?.name ?? '?'} size={18} />{r.app?.name ?? '—'}
                  </span>
                )},
                { key: 'customer', label: 'Customer', render: (r) => r.customer ? (
                  <div>
                    <div style={{ color: 'var(--ink)', fontWeight: 500 }}>{r.customer.name ?? r.customer.email}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>{r.customer.email}</div>
                  </div>
                ) : <span style={{ color: 'var(--muted)' }}>guest</span> },
                { key: 'type', label: 'Type', render: (r) => <TypePill type={r.type === 'subscription_payment' ? 'subscription' : r.type} /> },
                { key: 'provider', label: 'Provider', render: (r) => <ProviderTag name={r.provider} size="sm" /> },
                { key: 'amount', label: 'Amount', align: 'right', render: (r) => (
                  <span className="mono" style={{ fontWeight: 600, color: r.amount < 0 ? 'var(--bad)' : 'var(--ink)' }}>
                    {formatAmountCompact(r.amount, r.currency)}
                  </span>
                )},
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                { key: 'source', label: 'Source', render: (r) => r.source ? <SourceTag source={r.source} /> : '—' },
                { key: 'created', label: 'Created', align: 'right', render: (r) => (
                  <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{formatRelative(r.createdAt)}</span>
                )},
              ]}
              rows={list.data.data}
              getRowKey={(r) => r.id}
              onRowClick={(r) => onNavigate('transaction-detail', r.id)}
            />
            <Pager total={list.data.total} page={list.data.page} pageSize={list.data.pageSize} onChange={(p) => set('page', p)} />
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
        <button
          disabled={page <= 1}
          onClick={() => onChange(Math.max(1, page - 1))}
          style={{
            padding: '4px 8px', background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 4, fontSize: 11.5, color: page > 1 ? 'var(--ink-2)' : 'var(--muted-2)',
            cursor: page > 1 ? 'pointer' : 'not-allowed',
          }}
        >← Prev</button>
        <span style={{ fontSize: 11.5 }}>{page} of {last}</span>
        <button
          disabled={page >= last}
          onClick={() => onChange(Math.min(last, page + 1))}
          style={{
            padding: '4px 8px', background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 4, fontSize: 11.5, color: page < last ? 'var(--ink-2)' : 'var(--muted-2)',
            cursor: page < last ? 'pointer' : 'not-allowed',
          }}
        >Next →</button>
      </div>
    </div>
  );
}

// ─── Transaction Detail ──────────────────────────────────────────────────

export function TransactionDetailPage({ txId, onNavigate, onBack }: { txId: string | null; onNavigate: Navigate; onBack: () => void }) {
  const txQ = useFetch(() => api.transactions.one(txId!), [txId]);
  const [metaOpen, setMetaOpen] = React.useState(true);
  const [urlsOpen, setUrlsOpen] = React.useState(false);
  const [refundOpen, setRefundOpen] = React.useState(false);

  if (txQ.loading || !txQ.data) {
    return (
      <PageShell title="Transaction" breadcrumbs={[{ label: 'Transactions', onClick: onBack }, { label: '…' }]}>
        <LoadingBlock height={200} />
      </PageShell>
    );
  }
  if (txQ.error) {
    return (
      <PageShell title="Transaction" breadcrumbs={[{ label: 'Transactions', onClick: onBack }]}>
        <div style={{ padding: 16, color: 'var(--bad)' }}>{txQ.error.message}</div>
      </PageShell>
    );
  }
  const tx = txQ.data;
  const movement = (tx.logs ?? []).map(logToMovementEvent);

  return (
    <PageShell
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <span className="mono" style={{ fontSize: 19 }}>{tx.id.slice(0, 12)}…</span>
          <StatusBadge status={tx.status} />
        </span>
      }
      breadcrumbs={[{ label: 'Transactions', onClick: onBack }, { label: tx.id.slice(0, 12) }]}
      actions={
        <>
          <Button variant="secondary" size="md" leading={<Icon name="copy" size={12} />}
            onClick={() => navigator.clipboard?.writeText(tx.id)}>Copy ID</Button>
          <Button variant="secondary" size="md" leading={<Icon name="refresh" size={12} />}
            onClick={async () => { await api.transactions.sync(tx.id); txQ.refetch(); }}>
            Sync
          </Button>
          {tx.status === 'succeeded' && tx.type !== 'refund' && (
            <Button variant="danger" size="md" onClick={() => setRefundOpen(true)}>Refund</Button>
          )}
        </>
      }
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '20px 24px',
        boxShadow: 'var(--shadow-1)', marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>Amount</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
            <span style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.8, color: tx.amount < 0 ? 'var(--bad)' : 'var(--ink)' }}>
              {formatAmount(tx.amount, tx.currency)}
            </span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>{tx.currency}</span>
          </div>
          {tx.description && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>{tx.description}</div>}
        </div>
        <div style={{ display: 'flex', gap: 22 }}>
          <DetailMicro label="Type" value={<TypePill type={tx.type === 'subscription_payment' ? 'subscription' : tx.type} />} />
          <DetailMicro label="Provider" value={<ProviderTag name={tx.provider} />} />
          {tx.source && <DetailMicro label="Source" value={<SourceTag source={tx.source} />} />}
          <DetailMicro label="Created" value={<span className="mono" style={{ fontSize: 12 }}>{formatDateTime(tx.createdAt)}</span>} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Identification" padding={16}>
            <div style={{ padding: '4px 16px 14px' }}>
              <KV k="Transaction" v={<span className="mono">{tx.id}</span>} />
              {tx.app && (
                <KV k="App" v={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', color: 'var(--accent)' }}
                    onClick={() => onNavigate('app-detail', tx.app!.id)}>
                    <AppAvatar name={tx.app.name} size={16} />{tx.app.name}
                  </span>
                } />
              )}
              {tx.customer && (
                <KV k="Customer" v={
                  <span>{tx.customer.name ?? '—'} <span style={{ color: 'var(--muted)' }}>({tx.customer.email})</span></span>
                } />
              )}
              {tx.subscription && (
                <KV k="Subscription" v={
                  <span style={{ cursor: 'pointer', color: 'var(--accent)' }}
                    onClick={() => onNavigate('subscription-detail', tx.subscription!.id)}>
                    <span className="mono">{tx.subscription.id.slice(0, 12)}…</span>
                  </span>
                } />
              )}
              {tx.providerTxId && <KV k="Provider TX" v={<span className="mono">{tx.providerTxId}</span>} mono />}
              {tx.checkoutUrl && <KV k="Checkout URL" v={
                <a href={tx.checkoutUrl} target="_blank" rel="noreferrer" className="mono" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>open</a>
              } />}
              <KV k="Provider Created" v={tx.providerCreatedAt ? formatDateTime(tx.providerCreatedAt) : '—'} />
              <KV k="Webhook Received" v={tx.webhookReceivedAt ? formatDateTime(tx.webhookReceivedAt) : '—'} />
              <KV k="App Notified" v={tx.appNotifiedAt ? formatDateTime(tx.appNotifiedAt) : '—'} />
            </div>
          </Card>

          <CollapsibleCard
            title="Metadata"
            badge={<span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 4 }}>
              {Object.keys(tx.metadata ?? {}).length} keys
            </span>}
            open={metaOpen} onToggle={() => setMetaOpen((o) => !o)}
          >
            <CodeBlock>{JSON.stringify(tx.metadata ?? {}, null, 2)}</CodeBlock>
          </CollapsibleCard>

          <CollapsibleCard
            title="Redirect URLs"
            open={urlsOpen} onToggle={() => setUrlsOpen((o) => !o)}
          >
            <div style={{ padding: '10px 16px 14px' }}>
              <KV k="Success" v={<span className="mono">{tx.redirectSuccess ?? '—'}</span>} />
              <KV k="Failed"  v={<span className="mono">{tx.redirectFailed ?? '—'}</span>} />
            </div>
          </CollapsibleCard>
        </div>

        <Card padding={0}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 18px', borderBottom: '1px solid var(--hairline)',
          }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Movement Log</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                {movement.length} events
              </div>
            </div>
          </div>
          <div style={{ padding: '20px 26px 22px' }}>
            {movement.length > 0
              ? <MovementTimeline events={movement} />
              : <div style={{ color: 'var(--muted)', fontSize: 12 }}>No movement logged yet.</div>}
          </div>

          <div style={{ borderTop: '1px solid var(--hairline)' }}>
            <div style={{ padding: '14px 18px 6px' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Related Webhook Events</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                Outbound deliveries to the app
              </div>
            </div>
            {tx.webhookEvents && tx.webhookEvents.length > 0 ? (
              <Table
                dense
                columns={[
                  { key: 'id', label: 'Event', render: (r) => <span className="mono" style={{ color: 'var(--accent)' }}>{r.id.slice(0, 8)}…</span> },
                  { key: 'eventType', label: 'Type', render: (r) => <span className="mono" style={{ color: 'var(--ink-2)' }}>{r.eventType}</span> },
                  { key: 'attempts', label: 'Attempts', align: 'center', render: (r) => <span className="mono">{r.attempts}/{r.maxAttempts}</span> },
                  { key: 'deliveryStatus', label: 'Delivery', render: (r) => <StatusBadge status={r.deliveryStatus} size="sm" /> },
                  { key: 'deliveredAt', label: 'Delivered', align: 'right', render: (r) => <span className="mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{r.deliveredAt ? formatRelative(r.deliveredAt) : '—'}</span> },
                ]}
                rows={tx.webhookEvents}
                getRowKey={(r) => r.id}
                onRowClick={(r) => onNavigate('webhook-detail', r.id)}
              />
            ) : (
              <div style={{ padding: 16, color: 'var(--muted)', fontSize: 12 }}>No webhook deliveries yet.</div>
            )}
          </div>
        </Card>
      </div>

      {refundOpen && (
        <Modal title="Refund transaction" onClose={() => setRefundOpen(false)}>
          <RefundForm tx={tx} onClose={() => setRefundOpen(false)} onDone={() => { setRefundOpen(false); txQ.refetch(); }} />
        </Modal>
      )}
    </PageShell>
  );
}

function RefundForm({ tx, onClose, onDone }: {
  tx: Transaction; onClose: () => void; onDone: () => void;
}) {
  const [amount, setAmount] = React.useState(String(tx.amount / 100));
  const [reason, setReason] = React.useState('Customer request');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await api.transactions.refund(tx.id, {
        amount: Math.round(Number(amount) * 100),
        reason,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div style={{ padding: '4px 0 16px', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
        Issue a refund of up to <strong>{formatAmount(tx.amount, tx.currency)}</strong> via {tx.provider}.
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Amount</label>
          <input
            value={amount} onChange={(e) => setAmount(e.target.value)}
            type="number" step="0.01"
            style={{
              width: '100%', marginTop: 6, padding: '8px 11px', fontFamily: 'var(--font-mono)',
              fontSize: 14, border: '1px solid var(--border)', borderRadius: 6, outline: 'none',
            }}
          />
        </div>
        <FilterSelect label="Reason" value={reason} onChange={setReason}
          options={['Customer request', 'Duplicate', 'Fraudulent', 'Other']} />
      </div>
      {error && <div style={{ marginTop: 12, color: 'var(--bad)', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }}>
          {submitting ? 'Processing…' : 'Confirm refund'}
        </Button>
      </div>
    </>
  );
}

function logToMovementEvent(log: TransactionLog) {
  return {
    time: formatDateTime(log.createdAt),
    action: log.action,
    from: log.statusFrom,
    to: log.statusTo ?? '—',
    actor: log.actor,
    detail: typeof log.details === 'object' && log.details
      ? Object.entries(log.details).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')
      : '',
  };
}
