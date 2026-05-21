'use client';

import React from 'react';
import * as api from '../api/client';
import { formatAmount, formatAmountCompact, formatDateTime, formatRelative, pickPrimary } from '../api/format';
import { GuardedView, LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { Subscription } from '../api/types';
import { PageShell } from '../layout';
import { Button, Card, FilterSelect, Icon, KV, ProviderTag, StatusBadge, Table, AppAvatar } from '../primitives';
import { DetailMicro, MiniStatCard, Modal, MovementTimeline } from '../shared';
import { Navigate } from '../types';

const PAGE_SIZE = 20;

export function SubscriptionsPage({ onNavigate }: { onNavigate: Navigate }) {
  const [appFilter, setAppFilter] = React.useState('All');
  const [providerFilter, setProviderFilter] = React.useState('All');
  const [statusFilter, setStatusFilter] = React.useState('All');
  const [page, setPage] = React.useState(1);

  const apps = useFetch(() => api.apps.list(), []);
  const query: api.SubListQuery = {
    page, pageSize: PAGE_SIZE,
    appId: appFilter !== 'All' ? appFilter : undefined,
    provider: providerFilter !== 'All' ? providerFilter.toLowerCase() : undefined,
    status: statusFilter !== 'All' ? statusFilter.toLowerCase().replace(' ', '_') : undefined,
  };
  const list = useFetch(() => api.subscriptions.list(query), [JSON.stringify(query)]);
  const stats = useFetch(() => api.subscriptions.stats(query), [JSON.stringify(query)]);

  const appOptions = ['All', ...(apps.data?.data ?? []).map((a) => ({ value: a.id, label: a.name }))];

  return (
    <PageShell
      title="Subscriptions"
      breadcrumbs={[{ label: 'Operations' }, { label: 'Subscriptions' }]}
    >
      <GuardedView
        state={stats}
        height={70}
        render={(s) => {
          const mrr = pickPrimary(s.mrrEstimate);
          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
              <MiniStatCard label="Active" value={s.active} sub="recurring revenue" />
              <MiniStatCard label="Past Due" value={s.past_due} sub="retry in progress" warning={s.past_due > 0} />
              <MiniStatCard label="Paused" value={s.paused} sub="customer hold" />
              <MiniStatCard
                label="MRR estimate"
                value={mrr ? formatAmountCompact(mrr.amount, mrr.currency) : '—'}
                sub="active only"
              />
            </div>
          );
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <Icon name="filter" size={13} color="var(--muted)" />
        <FilterSelect label="App"      value={appFilter}      onChange={(v) => { setAppFilter(v); setPage(1); }}      options={appOptions} />
        <FilterSelect label="Provider" value={providerFilter} onChange={(v) => { setProviderFilter(v); setPage(1); }} options={['All', { value: 'lemonsqueezy', label: 'Lemon Squeezy' }, 'Xendit']} />
        <FilterSelect label="Status"   value={statusFilter}   onChange={(v) => { setStatusFilter(v); setPage(1); }}   options={['All', 'Active', 'Past Due', 'Canceled', 'Paused', 'Expired']} />
        <div style={{ flex: 1 }} />
        {list.data && (
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{list.data.total} subscriptions</span>
        )}
      </div>

      <Card padding={0}>
        {list.loading && <LoadingBlock height={200} />}
        {list.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{list.error.message}</div>}
        {list.data && (
          <>
            <Table<Subscription>
              columns={[
                { key: 'id', label: 'ID', render: (r) => <span className="mono" style={{ color: 'var(--accent)', fontWeight: 500 }}>{r.id.slice(0, 8)}…</span> },
                { key: 'app', label: 'App', render: (r) => (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <AppAvatar name={r.app?.name ?? '?'} size={18} />{r.app?.name ?? '—'}
                  </span>
                )},
                { key: 'customer', label: 'Customer', render: (r) => r.customer ? (
                  <div>
                    <div style={{ fontWeight: 500 }}>{r.customer.name ?? r.customer.email}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>{r.customer.email}</div>
                  </div>
                ) : '—' },
                { key: 'plan', label: 'Plan', render: (r) => r.plan?.name ?? '—' },
                { key: 'provider', label: 'Provider', render: (r) => <ProviderTag name={r.provider} size="sm" /> },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                { key: 'amount', label: 'Amount', align: 'right', render: (r) => r.plan
                  ? <span className="mono" style={{ fontWeight: 600 }}>{formatAmountCompact(r.plan.amount, r.plan.currency)}/{r.plan.interval[0]}</span>
                  : '—' },
                { key: 'next', label: 'Next Billing', align: 'right', render: (r) => (
                  <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{r.currentPeriodEnd ? formatRelative(r.currentPeriodEnd) : '—'}</span>
                )},
              ]}
              rows={list.data.data}
              getRowKey={(r) => r.id}
              onRowClick={(r) => onNavigate('subscription-detail', r.id)}
            />
            <Pager total={list.data.total} page={list.data.page} pageSize={list.data.pageSize} onChange={setPage} />
          </>
        )}
      </Card>
    </PageShell>
  );
}

function CancelSubForm({ sub, onClose, onDone }: {
  sub: Subscription; onClose: () => void; onDone: () => void;
}) {
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submit = async () => {
    setError(null); setSubmitting(true);
    try { await api.subscriptions.cancel(sub.id); onDone(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Cancel failed'); }
    finally { setSubmitting(false); }
  };
  return (
    <>
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6, marginBottom: 14 }}>
        Cancel <span className="mono">{sub.id.slice(0, 12)}…</span>? The provider will stop billing
        at the end of the current period; the customer keeps access until then.
      </div>
      {error && <div style={{ color: 'var(--bad)', fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button variant="secondary" onClick={onClose}>Keep subscription</Button>
        <Button variant="primary" onClick={submit} style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }}>
          {submitting ? 'Canceling…' : 'Confirm cancel'}
        </Button>
      </div>
    </>
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

// ─── Subscription Detail ────────────────────────────────────────────────

export function SubscriptionDetailPage({ subId, onNavigate, onBack }: { subId: string | null; onNavigate: Navigate; onBack: () => void }) {
  const subQ = useFetch(() => api.subscriptions.one(subId!), [subId]);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  if (subQ.loading || !subQ.data) {
    return (
      <PageShell title="Subscription" breadcrumbs={[{ label: 'Subscriptions', onClick: onBack }, { label: '…' }]}>
        <LoadingBlock height={200} />
      </PageShell>
    );
  }
  if (subQ.error) {
    return (
      <PageShell title="Subscription" breadcrumbs={[{ label: 'Subscriptions', onClick: onBack }]}>
        <div style={{ padding: 16, color: 'var(--bad)' }}>{subQ.error.message}</div>
      </PageShell>
    );
  }
  const sub = subQ.data;

  return (
    <PageShell
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <span className="mono" style={{ fontSize: 19 }}>{sub.id.slice(0, 12)}…</span>
          <StatusBadge status={sub.status} />
        </span>
      }
      breadcrumbs={[{ label: 'Subscriptions', onClick: onBack }, { label: sub.id.slice(0, 12) }]}
      actions={
        <>
          {sub.status === 'canceled' && sub.currentPeriodEnd && new Date(sub.currentPeriodEnd).getTime() > Date.now() && (
            <Button variant="primary" size="md"
              onClick={async () => {
                try { await api.subscriptions.reactivate(sub.id); subQ.refetch(); }
                catch (err) { alert(err instanceof Error ? err.message : 'Reactivate failed'); }
              }}>
              Reactivate
            </Button>
          )}
          {sub.status === 'paused' ? (
            <Button variant="primary" size="md"
              onClick={async () => { await api.subscriptions.resume(sub.id); subQ.refetch(); }}>
              Resume
            </Button>
          ) : sub.status === 'active' ? (
            <Button variant="secondary" size="md"
              onClick={async () => { await api.subscriptions.pause(sub.id); subQ.refetch(); }}>
              Pause
            </Button>
          ) : null}
          {sub.status !== 'canceled' && sub.status !== 'expired' && (
            <Button variant="danger" size="md" onClick={() => setCancelOpen(true)}>Cancel Subscription</Button>
          )}
        </>
      }
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '20px 24px',
        boxShadow: 'var(--shadow-1)', marginBottom: 16,
        display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 20, alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>Plan</div>
          <div className="serif" style={{ fontSize: 26, letterSpacing: -0.4, lineHeight: 1.15, marginTop: 4 }}>
            {sub.plan?.name ?? '—'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            {sub.customer?.name ?? '—'} · {sub.customer?.email ?? '—'}
          </div>
        </div>
        <DetailMicro label="Amount" value={
          <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
            {sub.plan ? `${formatAmount(sub.plan.amount, sub.plan.currency)}/${sub.plan.interval[0]}` : '—'}
          </span>
        } />
        <DetailMicro label="Current Period" value={
          <span className="mono" style={{ fontSize: 12 }}>
            {sub.currentPeriodStart ? formatDateTime(sub.currentPeriodStart) : '—'} – {sub.currentPeriodEnd ? formatDateTime(sub.currentPeriodEnd) : '—'}
          </span>
        } />
        <DetailMicro label="Next Billing" value={
          <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
            {sub.currentPeriodEnd ? formatDateTime(sub.currentPeriodEnd) : '—'}
          </span>
        } />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16 }}>
        <Card title="Identification" padding={0}>
          <div style={{ padding: '4px 16px 14px' }}>
            <KV k="Subscription" v={<span className="mono">{sub.id}</span>} />
            {sub.app && (
              <KV k="App" v={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', color: 'var(--accent)' }}
                  onClick={() => onNavigate('app-detail', sub.app!.id)}>
                  <AppAvatar name={sub.app.name} size={16} />{sub.app.name}
                </span>
              } />
            )}
            {sub.customer && <KV k="Customer" v={`${sub.customer.name ?? '—'} (${sub.customer.email})`} />}
            <KV k="Provider" v={<ProviderTag name={sub.provider} size="sm" />} />
            <KV k="Provider Sub ID" v={<span className="mono">{sub.providerSubscriptionId}</span>} mono />
            <KV k="Created" v={formatDateTime(sub.createdAt)} />
            <KV k="Cancel At" v={sub.cancelAt ? formatDateTime(sub.cancelAt) : '—'} />
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card padding={0}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--hairline)' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Payment History</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>Billing cycles for this subscription</div>
            </div>
            {sub.transactions && sub.transactions.length > 0 ? (
              <Table
                dense
                columns={[
                  { key: 'id', label: 'Transaction', render: (r) => <span className="mono" style={{ color: 'var(--accent)' }}>{r.id.slice(0, 8)}…</span> },
                  { key: 'date', label: 'Date', render: (r) => <span style={{ color: 'var(--muted)' }}>{formatDateTime(r.createdAt)}</span> },
                  { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="mono" style={{ fontWeight: 600 }}>{formatAmountCompact(r.amount, r.currency)}</span> },
                  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} size="sm" /> },
                ]}
                rows={sub.transactions}
                getRowKey={(r) => r.id}
                onRowClick={(r) => onNavigate('transaction-detail', r.id)}
              />
            ) : (
              <div style={{ padding: 16, color: 'var(--muted)', fontSize: 12 }}>No payments yet.</div>
            )}
          </Card>

          <Card padding={0}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--hairline)' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Subscription Lifecycle</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>Status transitions</div>
            </div>
            <div style={{ padding: '20px 26px 22px' }}>
              <MovementTimeline events={[
                { time: formatDateTime(sub.createdAt), action: 'subscription.created', from: null, to: 'pending', actor: 'app', detail: '' },
                { time: sub.currentPeriodStart ? formatDateTime(sub.currentPeriodStart) : '—', action: 'subscription.activated', from: 'pending', to: sub.status, actor: 'system', detail: '' },
                ...(sub.canceledAt ? [{ time: formatDateTime(sub.canceledAt), action: 'subscription.canceled', from: 'active', to: 'canceled', actor: 'admin', detail: '' }] : []),
              ]} />
            </div>
          </Card>
        </div>
      </div>

      {cancelOpen && (
        <Modal title="Cancel subscription" onClose={() => setCancelOpen(false)}>
          <CancelSubForm
            sub={sub}
            onClose={() => setCancelOpen(false)}
            onDone={() => { setCancelOpen(false); subQ.refetch(); }}
          />
        </Modal>
      )}
    </PageShell>
  );
}
