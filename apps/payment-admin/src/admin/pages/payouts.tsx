'use client';

import React from 'react';
import * as api from '../api/client';
import { formatAmount, formatDateTime } from '../api/format';
import { ErrorBlock, LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import {
  ExclusionReason, PayoutRun, PayoutRunDetail, PayoutRunPayout, PayoutRunStatus, PayoutStatus,
} from '../api/types';
import { PageShell } from '../layout';
import { AppAvatar, Button, Card, FilterSelect, Icon, StatusBadge, Table } from '../primitives';
import { Field, MiniStatCard, Modal, inputStyle } from '../shared';
import { Navigate } from '../types';
import { Pager } from './merchants';

const PAGE_SIZE = 20;
const POLL_STATUSES: PayoutRunStatus[] = ['building', 'queued', 'processing'];
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  paused: 'Paused',
  no_payout_destination: 'No payout details',
  below_minimum: 'Below minimum — rolls over to next run',
  balance_error: "Couldn't read balance",
  no_sub_account: 'No Xendit sub-account',
  payout_in_progress: 'Already has a payout in progress',
};

const RUN_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'All', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'building', label: 'Building' },
  { value: 'queued', label: 'Queued' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'completed_with_failures', label: 'Some failed' },
  { value: 'build_failed', label: 'Build failed' },
  { value: 'discarded', label: 'Discarded' },
];

function php(minor: number, currency = 'PHP') {
  return formatAmount(minor, currency);
}

// ─── Payout runs list ───────────────────────────────────────────────────

export function PayoutsPage({ onNavigate }: { onNavigate: Navigate }) {
  const [statusFilter, setStatusFilter] = React.useState('All');
  const [page, setPage] = React.useState(1);
  const [newOpen, setNewOpen] = React.useState(false);

  const query: api.PayoutRunListQuery = {
    page, pageSize: PAGE_SIZE,
    status: statusFilter !== 'All' ? (statusFilter as PayoutRunStatus) : undefined,
  };
  const list = useFetch(() => api.payoutRuns.list(query), [JSON.stringify(query)]);

  return (
    <PageShell
      title="Payouts"
      breadcrumbs={[{ label: 'Marketplace' }, { label: 'Payouts' }]}
      actions={
        <Button variant="primary" size="md" leading={<Icon name="plus" size={12} strokeWidth={2.4} />}
          onClick={() => setNewOpen(true)}>
          New payout run
        </Button>
      }
    >
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6, marginBottom: 14, maxWidth: 760 }}>
        A payout run checks every merchant&apos;s balance and builds a preview of who gets paid and how much.
        Nothing is sent until you look it over and press Confirm.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <Icon name="filter" size={13} color="var(--muted)" />
        <FilterSelect label="Status" value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} options={RUN_STATUS_OPTIONS} />
        <div style={{ flex: 1 }} />
        {list.data && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{list.data.total} runs</span>}
      </div>

      <Card padding={0}>
        {!list.data && list.loading && <LoadingBlock height={200} />}
        {list.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{list.error.message}</div>}
        {list.data && list.data.data.length === 0 && (
          <div style={{ padding: 24, color: 'var(--muted)', fontSize: 12.5, textAlign: 'center' }}>
            No payout runs yet. Press &quot;New payout run&quot; to build your first preview.
          </div>
        )}
        {list.data && list.data.data.length > 0 && (
          <>
            <Table<PayoutRun>
              columns={[
                { key: 'id', label: 'Run', render: (r) => <span className="mono" style={{ color: 'var(--accent)', fontWeight: 500 }}>{r.code}</span> },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                { key: 'app', label: 'App', render: (r) => r.appId ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <AppAvatar name={r.app?.name ?? '?'} size={18} />{r.app?.name ?? '—'}
                  </span>
                ) : <span style={{ color: 'var(--muted)' }}>All apps</span> },
                { key: 'count', label: 'Payouts', align: 'right', render: (r) => <span className="mono">{r.payoutCount}</span> },
                { key: 'total', label: 'Total', align: 'right', render: (r) => (
                  <span className="mono" style={{ fontWeight: 600 }}>{php(r.totalAmount, r.currency)}</span>
                )},
                { key: 'created', label: 'Started', align: 'right', render: (r) => (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11.5 }}>{formatDateTime(r.createdAt)}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.createdBy ?? '—'}</div>
                  </div>
                )},
              ]}
              rows={list.data.data}
              getRowKey={(r) => r.id}
              onRowClick={(r) => onNavigate('payout-run-detail', r.id)}
            />
            <Pager total={list.data.total} page={list.data.page} pageSize={list.data.pageSize} onChange={setPage} />
          </>
        )}
      </Card>

      {newOpen && (
        <Modal title="Start a payout run" onClose={() => setNewOpen(false)} width={480}>
          <NewRunForm
            onClose={() => setNewOpen(false)}
            onCreated={(id) => { setNewOpen(false); onNavigate('payout-run-detail', id); }}
            onOpenRun={(id) => { setNewOpen(false); onNavigate('payout-run-detail', id); }}
          />
        </Modal>
      )}
    </PageShell>
  );
}

function NewRunForm({ onClose, onCreated, onOpenRun }: {
  onClose: () => void;
  onCreated: (id: string) => void;
  onOpenRun: (id: string) => void;
}) {
  const settings = useFetch(() => api.marketplace.settings(), []);
  const [appId, setAppId] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [openRunId, setOpenRunId] = React.useState<string | null>(null);

  const enabledApps = (settings.data?.data ?? []).filter((a) => a.marketplaceEnabled);

  const submit = async () => {
    setError(null); setOpenRunId(null); setSubmitting(true);
    try {
      const run = await api.payoutRuns.create(appId ? { appId } : {});
      onCreated(run.id);
    } catch (err) {
      if (err instanceof api.ApiError && err.code === 'payout_run_open') {
        setOpenRunId(extractRunId(err));
      }
      setError(err instanceof Error ? err.message : 'Could not start the run');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6, marginBottom: 14 }}>
        AcePay will read each merchant&apos;s balance and build a preview. You&apos;ll get to review it
        (and untick anyone) before any money moves.
      </div>
      <Field label="Which merchants?" hint="Pick one app, or pay everyone across all marketplace apps.">
        <select value={appId} onChange={(e) => setAppId(e.target.value)} style={inputStyle}>
          <option value="">All apps</option>
          {enabledApps.map((a) => <option key={a.appId} value={a.appId}>{a.appName}</option>)}
        </select>
      </Field>
      {error && (
        <div style={{ color: 'var(--bad)', fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>
          {error}
          {openRunId && (
            <div style={{ marginTop: 6 }}>
              <button onClick={() => onOpenRun(openRunId)} style={{
                background: 'none', border: 'none', padding: 0, color: 'var(--accent)',
                fontSize: 12, fontWeight: 550, cursor: 'pointer',
              }}>
                Open that run →
              </button>
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={submitting}>
          {submitting ? 'Starting…' : 'Build preview'}
        </Button>
      </div>
    </>
  );
}

/** The 409 body may carry runId directly; otherwise it's in the message text. */
function extractRunId(err: api.ApiError): string | null {
  const body = err.body as { runId?: unknown; error?: { details?: { runId?: unknown } } } | undefined;
  if (typeof body?.runId === 'string') return body.runId;
  if (typeof body?.error?.details?.runId === 'string') return body.error.details.runId;
  return err.message.match(UUID_RE)?.[0] ?? null;
}

// ─── Payout run detail ──────────────────────────────────────────────────

export function PayoutRunDetailPage({ runId, onNavigate, onBack }: {
  runId: string | null; onNavigate: Navigate; onBack: () => void;
}) {
  const q = useFetch(() => api.payoutRuns.one(runId ?? ''), [runId]);
  const [run, setRun] = React.useState<PayoutRunDetail | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => { if (q.data) setRun(q.data); }, [q.data]);

  // Poll while the run is moving on its own.
  const status = run?.status;
  const { refetch } = q;
  React.useEffect(() => {
    if (!status || !POLL_STATUSES.includes(status)) return;
    const t = setInterval(refetch, 3000);
    return () => clearInterval(t);
  }, [status, refetch]);

  const crumbs = [{ label: 'Payouts', onClick: onBack }];

  if (!run) {
    return (
      <PageShell title="Payout run" breadcrumbs={[...crumbs, { label: '…' }]}>
        {q.error ? <ErrorBlock error={q.error} onRetry={q.refetch} /> : <LoadingBlock height={200} />}
      </PageShell>
    );
  }

  const act = async (key: string, fn: () => Promise<PayoutRunDetail>) => {
    setActionError(null); setBusy(key);
    try { setRun(await fn()); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Something went wrong'); }
    finally { setBusy(null); }
  };

  const discard = () => {
    if (!confirm('Discard this run? Nothing has been sent, so no money moves.')) return;
    void act('discard', () => api.payoutRuns.discard(run.id));
  };

  const exportCsv = async () => {
    setActionError(null); setBusy('csv');
    try { await api.payoutRuns.downloadCsv(run.id); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Export failed'); }
    finally { setBusy(null); }
  };

  const showExport = run.status !== 'building' && run.status !== 'build_failed';
  const canDiscard = run.status === 'draft' || run.status === 'build_failed';

  return (
    <PageShell
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <span>Payout run <span className="mono" style={{ fontSize: 17 }}>{run.code}</span></span>
          <StatusBadge status={run.status} />
        </span>
      }
      breadcrumbs={[...crumbs, { label: run.code }]}
      actions={
        <>
          {showExport && (
            <Button variant="secondary" size="md" leading={<Icon name="download" size={12} />}
              onClick={exportCsv} disabled={busy === 'csv'}>
              {busy === 'csv' ? 'Exporting…' : 'Export CSV'}
            </Button>
          )}
          {canDiscard && (
            <Button variant="danger" size="md" onClick={discard} disabled={busy === 'discard'}>
              {busy === 'discard' ? 'Discarding…' : 'Discard'}
            </Button>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
        <span>Scope: <span style={{ color: 'var(--ink-2)' }}>{run.appId ? (run.app?.name ?? 'One app') : 'All apps'}</span></span>
        <span>Started by <span style={{ color: 'var(--ink-2)' }}>{run.createdBy ?? '—'}</span> · {formatDateTime(run.createdAt)}</span>
        {run.confirmedAt && (
          <span>Confirmed by <span style={{ color: 'var(--ink-2)' }}>{run.confirmedBy ?? '—'}</span> · {formatDateTime(run.confirmedAt)}</span>
        )}
        {run.completedAt && <span>Finished {formatDateTime(run.completedAt)}</span>}
      </div>

      {actionError && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, background: 'var(--bad-soft)', color: 'var(--bad)', fontSize: 12.5 }}>
          {actionError}
        </div>
      )}

      {run.status === 'building' && (
        <Card padding={28}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', color: 'var(--ink-2)', fontSize: 13 }}>
            <Icon name="clock" size={16} color="var(--info)" />
            Reading each merchant&apos;s balance… this page updates by itself.
          </div>
        </Card>
      )}

      {run.status === 'build_failed' && (
        <Card padding={18} style={{ borderColor: 'var(--bad-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Icon name="warn" size={16} color="var(--bad)" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--bad)', marginBottom: 4 }}>Couldn&apos;t build the preview</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{run.errorMessage ?? 'Unknown error'}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
                Nothing was sent. Discard this run, then start a new one.
              </div>
            </div>
          </div>
        </Card>
      )}

      {run.status === 'discarded' && (
        <Card padding={16}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>This run was discarded. Nothing was sent.</div>
        </Card>
      )}

      {run.status === 'draft' && (
        <DraftView run={run} busy={busy === 'confirm'}
          onConfirm={(skip) => act('confirm', () => api.payoutRuns.confirm(run.id, { skipMerchantIds: skip }))} />
      )}

      {(run.status === 'queued' || run.status === 'processing'
        || run.status === 'completed' || run.status === 'completed_with_failures') && (
        <SentView run={run} onRunChange={setRun} onRefresh={refetch} />
      )}

      {run.status !== 'building' && run.excluded.length > 0 && (
        <ExcludedCard run={run} onNavigate={onNavigate} />
      )}
    </PageShell>
  );
}

function DraftView({ run, busy, onConfirm }: {
  run: PayoutRunDetail;
  busy: boolean;
  onConfirm: (skipMerchantIds: string[]) => void;
}) {
  const [skipped, setSkipped] = React.useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const toggle = (merchantId: string) => {
    setSkipped((s) => {
      const next = new Set(s);
      if (next.has(merchantId)) next.delete(merchantId); else next.add(merchantId);
      return next;
    });
  };
  const allTicked = skipped.size === 0;
  const toggleAll = () => {
    setSkipped(allTicked ? new Set(run.payouts.map((p) => p.merchantId)) : new Set());
  };

  const selected = run.payouts.filter((p) => !skipped.has(p.merchantId));
  const total = selected.reduce((sum, p) => sum + p.amount, 0);
  const expired = run.previewExpiresAt != null && new Date(run.previewExpiresAt).getTime() < Date.now();

  return (
    <>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '18px 22px',
        boxShadow: 'var(--shadow-1)', marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Preview — nothing has been sent yet</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
            Untick anyone you don&apos;t want to pay this time; they&apos;ll be picked up in the next run.
            {run.previewExpiresAt && (
              <> {expired ? 'This preview expired' : 'This preview is good until'}{' '}
                <span style={{ color: expired ? 'var(--bad)' : 'var(--ink-2)', fontWeight: 550 }}>{formatDateTime(run.previewExpiresAt)}</span>
                {expired ? ' — discard it and start a new run.' : '.'}
              </>
            )}
          </div>
        </div>
        <Button variant="primary" size="lg" disabled={busy || selected.length === 0 || expired}
          onClick={() => setConfirmOpen(true)}>
          {selected.length === 0
            ? 'Nobody selected'
            : `Pay ${selected.length} merchant${selected.length === 1 ? '' : 's'} — ${php(total, run.currency)}`}
        </Button>
      </div>

      <Card padding={0} style={{ marginBottom: 16 }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Who gets paid</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
              {selected.length} of {run.payouts.length} selected · {php(total, run.currency)}
            </div>
          </div>
        </div>
        {run.payouts.length === 0 ? (
          <div style={{ padding: 16, color: 'var(--muted)', fontSize: 12.5 }}>
            Nobody is due a payout right now. See the excluded list below for why.
          </div>
        ) : (
          <Table<PayoutRunPayout>
            columns={[
              { key: 'tick', label: '', width: 36, render: (r) => (
                <input type="checkbox" checked={!skipped.has(r.merchantId)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggle(r.merchantId)} />
              )},
              { key: 'merchant', label: 'Merchant', render: (r) => (
                <div>
                  <div style={{ fontWeight: 550 }}>{r.merchantName}</div>
                  <div className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{r.merchantExternalRef}</div>
                </div>
              )},
              { key: 'app', label: 'App', render: (r) => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <AppAvatar name={r.appName} size={18} />{r.appName}
                </span>
              )},
              { key: 'account', label: 'Account', render: (r) => (
                <div>
                  <div className="mono" style={{ fontSize: 11.5 }}>{r.channelCode ?? '—'} · {r.accountNumber ?? '—'}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 11 }}>{r.accountHolderName ?? ''}</div>
                </div>
              )},
              { key: 'balance', label: 'Balance', align: 'right', render: (r) => (
                <span className="mono" style={{ color: 'var(--muted)' }}>{r.balanceAtBuild != null ? php(r.balanceAtBuild, r.currency) : '—'}</span>
              )},
              { key: 'amount', label: 'Pay', align: 'right', render: (r) => (
                <span className="mono" style={{ fontWeight: 600, opacity: skipped.has(r.merchantId) ? 0.4 : 1 }}>{php(r.amount, r.currency)}</span>
              )},
            ]}
            rows={run.payouts}
            getRowKey={(r) => r.id}
            onRowClick={(r) => toggle(r.merchantId)}
          />
        )}
        {run.payouts.length > 1 && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--hairline)' }}>
            <Button variant="ghost" size="sm" onClick={toggleAll}>{allTicked ? 'Untick everyone' : 'Tick everyone'}</Button>
          </div>
        )}
      </Card>

      {confirmOpen && (
        <Modal title="Send these payouts?" onClose={() => setConfirmOpen(false)}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6, marginBottom: 14 }}>
            This sends <b>{php(total, run.currency)}</b> to <b>{selected.length}</b> merchant{selected.length === 1 ? '' : 's'} through Xendit.
            Once sent, payouts can&apos;t be pulled back.
            {skipped.size > 0 && <> {skipped.size} unticked merchant{skipped.size === 1 ? '' : 's'} will be left for the next run.</>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Go back</Button>
            <Button variant="primary" disabled={busy}
              onClick={() => { setConfirmOpen(false); onConfirm(Array.from(skipped)); }}>
              {busy ? 'Sending…' : `Yes, pay ${php(total, run.currency)}`}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

const RETRYABLE: PayoutStatus[] = ['failed', 'reversed', 'canceled'];

function SentView({ run, onRunChange, onRefresh }: {
  run: PayoutRunDetail;
  onRunChange: (r: PayoutRunDetail) => void;
  onRefresh: () => void;
}) {
  const [syncing, setSyncing] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<Record<string, string>>({});
  const [retrying, setRetrying] = React.useState(false);
  const [retryResult, setRetryResult] = React.useState<{ retried: number; notRetried: Array<{ payoutId: string; payoutCode: string; reason: string }> } | null>(null);
  const [retryError, setRetryError] = React.useState<string | null>(null);

  const c = run.counts;
  const a = run.amounts;
  const sum = (keys: PayoutStatus[], from: Partial<Record<PayoutStatus, number>>) =>
    keys.reduce((s, k) => s + (from[k] ?? 0), 0);

  const waitingKeys: PayoutStatus[] = ['queued', 'pending'];
  const failedKeys: PayoutStatus[] = RETRYABLE;
  const hasFailures = sum(failedKeys, c) > 0;

  const syncRow = async (p: PayoutRunPayout) => {
    setSyncing(p.id);
    setRowError((e) => { const n = { ...e }; delete n[p.id]; return n; });
    try {
      await api.payoutRuns.syncPayout(p.id);
      onRefresh();
    } catch (err) {
      setRowError((e) => ({ ...e, [p.id]: err instanceof Error ? err.message : 'Sync failed' }));
    } finally {
      setSyncing(null);
    }
  };

  const retry = async () => {
    if (!confirm('Re-send every failed payout in this run, using each merchant\'s current payout details?')) return;
    setRetrying(true); setRetryError(null); setRetryResult(null);
    try {
      const res = await api.payoutRuns.retryFailed(run.id);
      setRetryResult({ retried: res.retried, notRetried: res.notRetried });
      onRunChange(res.run);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

  const merchantName = (payoutId: string, payoutCode: string) =>
    run.payouts.find((p) => p.id === payoutId)?.merchantName ?? payoutCode;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
        <MiniStatCard label="Sent" value={run.payoutCount} sub={php(run.totalAmount, run.currency)} />
        <MiniStatCard label="On the way" value={sum(waitingKeys, c)} sub={php(sum(waitingKeys, a), run.currency)} />
        <MiniStatCard label="Succeeded" value={c.succeeded ?? 0} sub={php(a.succeeded ?? 0, run.currency)} />
        <MiniStatCard label="Failed" value={sum(failedKeys, c)} sub={php(sum(failedKeys, a), run.currency)} warning={hasFailures} />
      </div>
      {(c.skipped ?? 0) > 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          {c.skipped} merchant{c.skipped === 1 ? ' was' : 's were'} unticked and skipped ({php(a.skipped ?? 0, run.currency)}).
        </div>
      )}

      {(retryResult || retryError) && (
        <div style={{
          marginBottom: 14, padding: '10px 14px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.6,
          background: retryError ? 'var(--bad-soft)' : 'var(--ok-soft)',
          color: retryError ? 'var(--bad)' : 'var(--ink-2)',
        }}>
          {retryError ?? (retryResult && (
            <>
              Re-sent {retryResult.retried} payout{retryResult.retried === 1 ? '' : 's'}.
              {retryResult.notRetried.length > 0 && (
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {retryResult.notRetried.map((n) => (
                    <li key={n.payoutId}>Not re-sent — {merchantName(n.payoutId, n.payoutCode)}: {n.reason}</li>
                  ))}
                </ul>
              )}
            </>
          ))}
        </div>
      )}

      <Card padding={0} style={{ marginBottom: 16 }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Payouts</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
              {POLL_STATUSES.includes(run.status)
                ? 'Updating every few seconds…'
                : 'Use "Sync" on a pending payout if its status looks stuck.'}
            </div>
          </div>
          {hasFailures && (
            <Button variant="primary" size="sm" leading={<Icon name="refresh" size={11} />} disabled={retrying} onClick={retry}>
              {retrying ? 'Retrying…' : 'Retry failed'}
            </Button>
          )}
        </div>
        <Table<PayoutRunPayout>
          columns={[
            { key: 'merchant', label: 'Merchant', render: (r) => (
              <div>
                <div style={{ fontWeight: 550 }}>{r.merchantName}</div>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>{r.appName}</div>
              </div>
            )},
            { key: 'account', label: 'Account', render: (r) => (
              <span className="mono" style={{ fontSize: 11.5 }}>{r.channelCode ?? '—'} · {r.accountNumber ?? '—'}</span>
            )},
            { key: 'amount', label: 'Amount', align: 'right', render: (r) => (
              <span className="mono" style={{ fontWeight: 600 }}>{php(r.amount, r.currency)}</span>
            )},
            { key: 'status', label: 'Status', render: (r) => (
              <div>
                <StatusBadge status={r.status} size="sm" />
                {r.retryOf && <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--muted)' }}>retry</span>}
                {(r.failureCode || r.failureMessage) && (
                  <div style={{ fontSize: 11, color: 'var(--bad)', marginTop: 3, whiteSpace: 'normal', maxWidth: 280 }}>
                    {r.failureCode ? `${r.failureCode}${r.failureMessage ? ': ' : ''}` : ''}{r.failureMessage ?? ''}
                  </div>
                )}
                {rowError[r.id] && (
                  <div style={{ fontSize: 11, color: 'var(--bad)', marginTop: 3, whiteSpace: 'normal', maxWidth: 280 }}>{rowError[r.id]}</div>
                )}
              </div>
            )},
            { key: 'when', label: 'Arrives', align: 'right', render: (r) => (
              <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                {r.completedAt ? formatDateTime(r.completedAt) : r.estimatedArrivalAt ? `~${formatDateTime(r.estimatedArrivalAt)}` : '—'}
              </span>
            )},
            { key: 'sync', label: '', align: 'right', render: (r) => r.status === 'pending' ? (
              <Button variant="ghost" size="sm" disabled={syncing === r.id} onClick={() => syncRow(r)}
                title="Ask Xendit for this payout's latest status">
                {syncing === r.id ? 'Syncing…' : 'Sync'}
              </Button>
            ) : null },
          ]}
          rows={run.payouts}
          getRowKey={(r) => r.id}
        />
      </Card>
    </>
  );
}

function ExcludedCard({ run, onNavigate }: { run: PayoutRunDetail; onNavigate: Navigate }) {
  return (
    <Card padding={0}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Excluded from this run · {run.excluded.length}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
          These merchants weren&apos;t included. Their money stays in their balance for a later run.
        </div>
      </div>
      <Table
        dense
        columns={[
          { key: 'merchant', label: 'Merchant', render: (r) => <span style={{ fontWeight: 550 }}>{r.merchantName}</span> },
          { key: 'reason', label: 'Why', wrap: true, render: (r) => (
            <div>
              <div>{EXCLUSION_LABEL[r.reason] ?? r.reason}</div>
              {r.detail && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{r.detail}</div>}
            </div>
          )},
          { key: 'balance', label: 'Balance', align: 'right', render: (r) => (
            <span className="mono" style={{ color: 'var(--muted)' }}>{r.balance != null ? php(r.balance, run.currency) : '—'}</span>
          )},
        ]}
        rows={run.excluded}
        getRowKey={(r) => r.merchantId}
        onRowClick={(r) => onNavigate('merchant-detail', r.merchantId)}
      />
    </Card>
  );
}
