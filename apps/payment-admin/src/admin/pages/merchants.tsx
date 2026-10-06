'use client';

import React from 'react';
import * as api from '../api/client';
import { formatAmount, formatDateTime } from '../api/format';
import { ErrorBlock, LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { MerchantDetail, MerchantListRow, MerchantStatus, Payout } from '../api/types';
import { PageShell } from '../layout';
import { AppAvatar, Button, Card, FilterSelect, Icon, KV, SearchInput, StatusBadge, Table } from '../primitives';
import { DetailMicro, Field, inputStyle } from '../shared';
import { Navigate } from '../types';

const PAGE_SIZE = 20;

// ─── Small shared bits (also used by the payouts pages) ─────────────────

export function Pager({ total, page, pageSize, onChange }: { total: number; page: number; pageSize: number; onChange: (p: number) => void }) {
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

export function Chip({ tone, children, title }: { tone: 'warn' | 'info' | 'bad'; children: React.ReactNode; title?: string }) {
  const colors = {
    warn: { fg: 'var(--warn)', bg: 'var(--warn-soft)' },
    info: { fg: 'var(--info)', bg: 'var(--info-soft)' },
    bad:  { fg: 'var(--bad)',  bg: 'var(--bad-soft)' },
  }[tone];
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 7px', borderRadius: 4, background: colors.bg, color: colors.fg,
      fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {tone !== 'info' && <Icon name="warn" size={10} strokeWidth={2} />}
      {children}
    </span>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Fee cell: base fee, or the override (+ "until <date>") when one is set. */
function FeeText({ m }: { m: Pick<MerchantListRow, 'feePercent' | 'feeOverridePercent' | 'feeOverrideEndsAt'> }) {
  if (m.feeOverridePercent != null) {
    const ended = m.feeOverrideEndsAt != null && new Date(m.feeOverrideEndsAt).getTime() < Date.now();
    return (
      <span>
        <span className="mono" style={{ fontWeight: 600, textDecoration: ended ? 'line-through' : undefined }}>
          {m.feeOverridePercent}%
        </span>
        <span style={{ color: 'var(--muted)', fontSize: 11 }}>
          {m.feeOverrideEndsAt ? ` ${ended ? 'ended' : 'until'} ${formatDate(m.feeOverrideEndsAt)}` : ' (special rate)'}
        </span>
        {m.feePercent != null && (
          <div style={{ color: 'var(--muted)', fontSize: 11 }}>normally {m.feePercent}%</div>
        )}
      </span>
    );
  }
  return <span className="mono">{m.feePercent != null ? `${m.feePercent}%` : '—'}</span>;
}

// ─── Merchants list ─────────────────────────────────────────────────────

export function MerchantsPage({ onNavigate }: { onNavigate: Navigate }) {
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [appFilter, setAppFilter] = React.useState('All');
  const [statusFilter, setStatusFilter] = React.useState('All');
  const [page, setPage] = React.useState(1);

  // Debounce typing so we don't hit the API on every keystroke.
  React.useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const settings = useFetch(() => api.marketplace.settings(), []);
  const query: api.MerchantListQuery = {
    page, pageSize: PAGE_SIZE,
    appId: appFilter !== 'All' ? appFilter : undefined,
    status: statusFilter !== 'All' ? (statusFilter as MerchantStatus) : undefined,
    search: search || undefined,
  };
  const list = useFetch(() => api.merchants.list(query), [JSON.stringify(query)]);

  const appOptions = ['All', ...(settings.data?.data ?? []).map((a) => ({ value: a.appId, label: a.appName }))];

  return (
    <PageShell title="Merchants" breadcrumbs={[{ label: 'Marketplace' }, { label: 'Merchants' }]}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6, marginBottom: 14, maxWidth: 760 }}>
        Merchants are the businesses an app collects money for. Apps add them through the API;
        here you can check their payout details, pause them, or give them a special fee.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Search code, name, email or ref…" width={260} />
        <Icon name="filter" size={13} color="var(--muted)" style={{ marginLeft: 4 }} />
        <FilterSelect label="App" value={appFilter} onChange={(v) => { setAppFilter(v); setPage(1); }} options={appOptions} />
        <FilterSelect label="Status" value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} options={[
          'All',
          { value: 'active', label: 'Active' },
          { value: 'pending', label: 'Pending' },
          { value: 'paused', label: 'Paused' },
          { value: 'suspended', label: 'Suspended' },
        ]} />
        <div style={{ flex: 1 }} />
        {list.data && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{list.data.total} merchants</span>}
      </div>

      <Card padding={0}>
        {!list.data && list.loading && <LoadingBlock height={200} />}
        {list.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{list.error.message}</div>}
        {list.data && list.data.data.length === 0 && (
          <div style={{ padding: 24, color: 'var(--muted)', fontSize: 12.5, textAlign: 'center' }}>
            {search || appFilter !== 'All' || statusFilter !== 'All'
              ? 'No merchants match these filters.'
              : 'No merchants yet. They show up here once an app adds them.'}
          </div>
        )}
        {list.data && list.data.data.length > 0 && (
          <>
            <Table<MerchantListRow>
              columns={[
                { key: 'name', label: 'Merchant', render: (r) => (
                  <div>
                    <div style={{ fontWeight: 550 }}>{r.name}</div>
                    <div className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{r.externalRef}</div>
                  </div>
                )},
                { key: 'app', label: 'App', render: (r) => (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <AppAvatar name={r.appName} size={18} />{r.appName}
                  </span>
                )},
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                { key: 'fee', label: 'Fee', render: (r) => <FeeText m={r} /> },
                { key: 'payout', label: 'Payout account', render: (r) => (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {r.hasPayoutDestination ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className="mono" style={{ fontSize: 11.5 }}>{r.payoutChannelCode ?? '—'}</span>
                        <span className="mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{r.payoutAccount ?? ''}</span>
                      </span>
                    ) : (
                      <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>No payout details yet</span>
                    )}
                    <span style={{ display: 'inline-flex', gap: 5 }}>
                      {r.duplicateDestinationInApp && (
                        <Chip tone="warn">Same account as another merchant in this app</Chip>
                      )}
                      {r.sharedDestinationOtherApps > 0 && (
                        <Chip tone="info" title="The same payout account is used by a merchant in another app. Usually fine — e.g. one business on two apps.">
                          Also used in {r.sharedDestinationOtherApps} other app{r.sharedDestinationOtherApps === 1 ? '' : 's'}
                        </Chip>
                      )}
                    </span>
                  </div>
                )},
                { key: 'created', label: 'Added', align: 'right', render: (r) => (
                  <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{formatDate(r.createdAt)}</span>
                )},
              ]}
              rows={list.data.data}
              getRowKey={(r) => r.id}
              onRowClick={(r) => onNavigate('merchant-detail', r.id)}
            />
            <Pager total={list.data.total} page={list.data.page} pageSize={list.data.pageSize} onChange={setPage} />
          </>
        )}
      </Card>
    </PageShell>
  );
}

// ─── Merchant detail ────────────────────────────────────────────────────

export function MerchantDetailPage({ merchantId, onNavigate, onBack }: {
  merchantId: string | null; onNavigate: Navigate; onBack: () => void;
}) {
  const q = useFetch(() => api.merchants.one(merchantId ?? ''), [merchantId]);
  const [merchant, setMerchant] = React.useState<MerchantDetail | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [balanceKey, setBalanceKey] = React.useState(0);

  React.useEffect(() => { if (q.data) setMerchant(q.data); }, [q.data]);

  const crumbs = [{ label: 'Merchants', onClick: onBack }];

  if (!merchant) {
    return (
      <PageShell title="Merchant" breadcrumbs={[...crumbs, { label: '…' }]}>
        {q.error ? <ErrorBlock error={q.error} onRetry={q.refetch} /> : <LoadingBlock height={200} />}
      </PageShell>
    );
  }
  const m = merchant;

  const run = async (key: string, fn: () => Promise<MerchantDetail>, done?: string) => {
    setActionError(null); setNotice(null); setBusy(key);
    try {
      const updated = await fn();
      setMerchant(updated);
      if (done) setNotice(done);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const canToggle = m.status === 'active' || m.status === 'paused';

  return (
    <PageShell
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          {m.name}
          <StatusBadge status={m.status} />
        </span>
      }
      breadcrumbs={[...crumbs, { label: m.name }]}
      actions={
        <>
          <Button variant="secondary" size="md" leading={<Icon name="refresh" size={12} />}
            disabled={busy === 'sync'}
            onClick={() => run('sync', () => api.merchants.sync(m.id), 'Checked with Xendit — details are up to date.').then(() => setBalanceKey((k) => k + 1))}>
            {busy === 'sync' ? 'Syncing…' : 'Sync with Xendit'}
          </Button>
          {canToggle && (m.status === 'active' ? (
            <Button variant="secondary" size="md" leading={<Icon name="pause" size={12} />}
              disabled={busy === 'status'}
              onClick={() => {
                if (!confirm(`Pause ${m.name}? They won't be included in payout runs until you resume them.`)) return;
                void run('status', () => api.merchants.update(m.id, { status: 'paused' }), 'Merchant paused.');
              }}>
              Pause
            </Button>
          ) : (
            <Button variant="primary" size="md" leading={<Icon name="play" size={12} />}
              disabled={busy === 'status'}
              onClick={() => run('status', () => api.merchants.update(m.id, { status: 'active' }), 'Merchant resumed.')}>
              Resume
            </Button>
          ))}
        </>
      }
    >
      {actionError && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, background: 'var(--bad-soft)', color: 'var(--bad)', fontSize: 12.5 }}>
          {actionError}
        </div>
      )}
      {notice && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, background: 'var(--ok-soft)', color: 'var(--ok)', fontSize: 12.5 }}>
          {notice}
        </div>
      )}

      <BalanceCard key={balanceKey} merchantId={m.id} />

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Profile" padding={0}>
            <div style={{ padding: '4px 16px 14px' }}>
              <KV k="Name" v={m.name} />
              <KV k="Email" v={m.email} />
              <KV k="App" v={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', color: 'var(--accent)' }}
                  onClick={() => onNavigate('app-detail', m.appId)}>
                  <AppAvatar name={m.appName} size={16} />{m.appName}
                </span>
              } />
              <KV k="App's reference" v={<span className="mono">{m.externalRef}</span>} />
              <KV k="AcePay code" v={<span className="mono">{m.code}</span>} />
              <KV k="Xendit account" v={<span className="mono">{m.xenditAccountId ?? 'Not created yet'}</span>} />
              <KV k="Xendit status" v={m.xenditAccountStatus ?? '—'} />
              <KV k="Added" v={formatDateTime(m.createdAt)} />
              <KV k="Updated" v={formatDateTime(m.updatedAt)} />
            </div>
          </Card>

          <FeeOverrideCard m={m} busy={busy === 'fee'}
            onSave={(body, done) => run('fee', () => api.merchants.update(m.id, body), done)} />

          {m.sharedWith.length > 0 && (
            <Card title="Same payout account" subtitle="Other merchants that get paid to this exact account" padding={0}>
              <div style={{ padding: '6px 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {m.sharedWith.some((s) => s.sameApp) && (
                  <div style={{ fontSize: 11.5, color: 'var(--warn)', lineHeight: 1.5, marginTop: 6 }}>
                    Two merchants in the same app paying out to one account is unusual — double-check
                    this isn&apos;t a mistake or a duplicate sign-up.
                  </div>
                )}
                {m.sharedWith.map((s) => (
                  <div key={s.merchantId}
                    onClick={() => onNavigate('merchant-detail', s.merchantId)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                      background: s.sameApp ? 'var(--warn-soft)' : 'var(--surface-2)',
                      border: '1px solid var(--hairline)',
                    }}>
                    <span>
                      <div style={{ fontSize: 12.5, fontWeight: 550 }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.appName}</div>
                    </span>
                    {s.sameApp
                      ? <Chip tone="warn">Same app</Chip>
                      : <Chip tone="info">Other app</Chip>}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <PayoutDetailsCard m={m} busy={busy === 'payout'}
            onSave={(body) => run('payout', () => api.merchants.update(m.id, body), 'Payout details saved.')} />
          <PayoutHistoryCard merchantId={m.id} onNavigate={onNavigate} />
        </div>
      </div>
    </PageShell>
  );
}

function BalanceCard({ merchantId }: { merchantId: string }) {
  const bal = useFetch(() => api.merchants.balance(merchantId), [merchantId]);
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '18px 22px',
      boxShadow: 'var(--shadow-1)', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Balance</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>Read live from the merchant&apos;s Xendit sub-account</div>
        </div>
        <Button variant="ghost" size="sm" leading={<Icon name="refresh" size={11} />} onClick={bal.refetch} disabled={bal.loading}>
          {bal.loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>
      {bal.error && (
        <div style={{ fontSize: 12, color: 'var(--bad)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="warn" size={13} />
          Couldn&apos;t read the balance right now: {bal.error.message}
        </div>
      )}
      {!bal.error && !bal.data && <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>Loading…</div>}
      {!bal.error && bal.data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
          <DetailMicro label="Available" value={
            <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{formatAmount(bal.data.available, bal.data.currency)}</span>
          } />
          <DetailMicro label="Can be paid out" value={
            <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ok)' }}>{formatAmount(bal.data.payable, bal.data.currency)}</span>
          } />
          <DetailMicro label="On the way" value={
            <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{formatAmount(bal.data.inFlight, bal.data.currency)}</span>
          } />
          <DetailMicro label="Minimum payout" value={
            <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--muted)' }}>{formatAmount(bal.data.minPayout, bal.data.currency)}</span>
          } />
        </div>
      )}
    </div>
  );
}

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function FeeOverrideCard({ m, busy, onSave }: {
  m: MerchantDetail;
  busy: boolean;
  onSave: (body: api.UpdateMerchantBody, done: string) => void;
}) {
  const [percent, setPercent] = React.useState(m.feeOverridePercent == null ? '' : String(m.feeOverridePercent));
  const [endsAt, setEndsAt] = React.useState(toDateInput(m.feeOverrideEndsAt));
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPercent(m.feeOverridePercent == null ? '' : String(m.feeOverridePercent));
    setEndsAt(toDateInput(m.feeOverrideEndsAt));
  }, [m.feeOverridePercent, m.feeOverrideEndsAt]);

  const save = () => {
    setError(null);
    const n = Number(percent);
    if (percent.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100) {
      setError('Enter a fee between 0 and 100.');
      return;
    }
    // End of the chosen day, in the operator's local time.
    const ends = endsAt ? new Date(`${endsAt}T23:59:59`).toISOString() : null;
    onSave({ feeOverridePercent: n, feeOverrideEndsAt: ends }, 'Special fee saved.');
  };

  return (
    <Card title="Special fee" subtitle={`Normally ${m.feePercent ?? '—'}% (the app's fee)`} padding={0}>
      <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 }}>
          Give this merchant a different fee — for example a 10% founding rate until a date.
          Leave the end date empty to keep it until you clear it.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Fee %">
            <input value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="decimal"
              placeholder="e.g. 10" style={inputStyle} />
          </Field>
          <Field label="Ends on (optional)">
            <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={inputStyle} />
          </Field>
        </div>
        {error && <div style={{ color: 'var(--bad)', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {m.feeOverridePercent != null && (
            <Button variant="ghost" size="sm" disabled={busy}
              onClick={() => onSave({ feeOverridePercent: null, feeOverrideEndsAt: null }, 'Special fee removed — back to the app fee.')}>
              Clear
            </Button>
          )}
          <Button variant="primary" size="sm" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save fee'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function PayoutDetailsCard({ m, busy, onSave }: {
  m: MerchantDetail;
  busy: boolean;
  onSave: (body: api.UpdateMerchantBody) => void;
}) {
  const channels = useFetch(() => api.marketplace.channels('PHP'), []);
  const [channel, setChannel] = React.useState(m.payoutChannelCode ?? '');
  const [account, setAccount] = React.useState(m.payoutAccountNumber ?? '');
  const [holder, setHolder] = React.useState(m.payoutAccountHolderName ?? '');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setChannel(m.payoutChannelCode ?? '');
    setAccount(m.payoutAccountNumber ?? '');
    setHolder(m.payoutAccountHolderName ?? '');
  }, [m.payoutChannelCode, m.payoutAccountNumber, m.payoutAccountHolderName]);

  const dirty = channel !== (m.payoutChannelCode ?? '')
    || account !== (m.payoutAccountNumber ?? '')
    || holder !== (m.payoutAccountHolderName ?? '');

  const save = () => {
    setError(null);
    if (!channel.trim() || !account.trim() || !holder.trim()) {
      setError('Fill in all three — where to send, the account number, and the account name.');
      return;
    }
    onSave({
      payoutChannelCode: channel.trim(),
      payoutAccountNumber: account.trim(),
      payoutAccountHolderName: holder.trim(),
    });
  };

  const list = channels.data ?? [];
  const hasCurrent = channel === '' || list.some((c) => c.channelCode === channel);

  return (
    <Card title="Payout details" subtitle="Where this merchant's money gets sent" padding={0}>
      <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field
          label="Send to"
          hint={channels.error
            ? "Couldn't load the list of banks and e-wallets from Xendit — type the channel code instead (e.g. PH_GCASH, PH_BDO)."
            : 'Bank or e-wallet, e.g. GCash, Maya, BDO.'}
        >
          {channels.error ? (
            <input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="PH_GCASH"
              className="mono" style={inputStyle} />
          ) : (
            <select value={channel} onChange={(e) => setChannel(e.target.value)} style={inputStyle} disabled={channels.loading && !channels.data}>
              <option value="">{channels.loading && !channels.data ? 'Loading…' : 'Choose a bank or e-wallet'}</option>
              {!hasCurrent && <option value={channel}>{channel}</option>}
              {list.map((c) => (
                <option key={c.channelCode} value={c.channelCode}>
                  {c.channelName} ({c.channelCode}){c.channelCategory ? ` · ${c.channelCategory.toLowerCase()}` : ''}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Account / mobile number">
            <input value={account} onChange={(e) => setAccount(e.target.value)} className="mono" style={inputStyle} />
          </Field>
          <Field label="Account name">
            <input value={holder} onChange={(e) => setHolder(e.target.value)} style={inputStyle} />
          </Field>
        </div>
        {error && <div style={{ color: 'var(--bad)', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" size="sm" disabled={busy || !dirty} onClick={save}>
            {busy ? 'Saving…' : 'Save payout details'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function PayoutHistoryCard({ merchantId, onNavigate }: { merchantId: string; onNavigate: Navigate }) {
  const [page, setPage] = React.useState(1);
  const list = useFetch(() => api.merchants.payouts(merchantId, { page, pageSize: 10 }), [merchantId, page]);
  return (
    <Card padding={0}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Payout history</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>Every payout sent to this merchant</div>
      </div>
      {!list.data && list.loading && <LoadingBlock height={100} />}
      {list.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{list.error.message}</div>}
      {list.data && list.data.data.length === 0 && (
        <div style={{ padding: 16, color: 'var(--muted)', fontSize: 12 }}>No payouts yet.</div>
      )}
      {list.data && list.data.data.length > 0 && (
        <>
          <Table<Payout>
            dense
            columns={[
              { key: 'date', label: 'Date', render: (r) => <span style={{ color: 'var(--muted)' }}>{formatDateTime(r.sentAt ?? r.createdAt)}</span> },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="mono" style={{ fontWeight: 600 }}>{formatAmount(r.amount, r.currency)}</span> },
              { key: 'to', label: 'Sent to', render: (r) => (
                <span className="mono" style={{ fontSize: 11.5 }}>{r.channelCode ?? '—'} <span style={{ color: 'var(--muted)' }}>{r.accountNumber ?? ''}</span></span>
              )},
              { key: 'status', label: 'Status', render: (r) => (
                <div>
                  <StatusBadge status={r.status} size="sm" />
                  {r.failureMessage && (
                    <div style={{ fontSize: 11, color: 'var(--bad)', marginTop: 3, whiteSpace: 'normal', maxWidth: 240 }}>
                      {r.failureCode ? `${r.failureCode}: ` : ''}{r.failureMessage}
                    </div>
                  )}
                </div>
              )},
              { key: 'run', label: 'Run', align: 'right', render: (r) => r.runId ? (
                <span className="mono" style={{ color: 'var(--accent)', fontSize: 11.5 }}>{r.runCode ?? '—'}</span>
              ) : '—' },
            ]}
            rows={list.data.data}
            getRowKey={(r) => r.id}
            onRowClick={(r) => { if (r.runId) onNavigate('payout-run-detail', r.runId); }}
          />
          <Pager total={list.data.total} page={list.data.page} pageSize={list.data.pageSize} onChange={setPage} />
        </>
      )}
    </Card>
  );
}
