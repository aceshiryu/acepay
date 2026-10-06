'use client';

import React from 'react';
import * as api from '../api/client';
import { formatAmount, formatDateTime } from '../api/format';
import { ErrorBlock, LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import {
  MarketplaceAppSummary, MarketplaceConfigChange, MarketplaceConfigField, MarketplaceDefaults,
  MarketplaceSettingsRow, MerchantStatus,
} from '../api/types';
import { PageShell } from '../layout';
import { AppAvatar, Button, Card, FilterSelect, Icon, StatusBadge, Table } from '../primitives';
import { DetailMicro, Field, inputStyle } from '../shared';
import { Navigate } from '../types';
import { Pager } from './merchants';

/** "12.5" (pesos typed by the operator) → 1250 centavos. Returns null when unusable. */
export function pesosToMinor(v: string): number | null {
  const n = Number(v.trim());
  if (v.trim() === '' || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** 1250 centavos → "12.50" for an input box. */
export function minorToPesoInput(minor: number | null | undefined): string {
  if (minor == null) return '';
  return (minor / 100).toFixed(2).replace(/\.00$/, '');
}

interface RowDraft {
  enabled: boolean;
  feePercent: string;
  minPayout: string; // pesos (major units)
  feeMin: string;    // app-settable fee range; both empty = operator-only
  feeMax: string;
}

function draftFrom(row: MarketplaceSettingsRow): RowDraft {
  return {
    enabled: row.marketplaceEnabled,
    feePercent: row.feePercent == null ? '' : String(row.feePercent),
    minPayout: minorToPesoInput(row.minPayout),
    feeMin: row.feeBounds ? String(row.feeBounds.min) : '',
    feeMax: row.feeBounds ? String(row.feeBounds.max) : '',
  };
}

type ParsedDraft =
  | { fee: number | null; minPayout: number | undefined; feeMin: number | null; feeMax: number | null }
  | { error: string };

/** Shared client-side checks for a settings row and the defaults card. */
function parseDraft(d: RowDraft): ParsedDraft {
  const badPct = (n: number | null) => n != null && (!Number.isFinite(n) || n < 0 || n > 100);
  const fee = d.feePercent.trim() === '' ? null : Number(d.feePercent);
  if (badPct(fee)) return { error: 'Fee must be a number between 0 and 100.' };
  const minPayout = d.minPayout.trim() === '' ? undefined : pesosToMinor(d.minPayout);
  if (minPayout === null) return { error: 'Minimum payout must be a peso amount, like 500.' };
  const minEmpty = d.feeMin.trim() === '';
  const maxEmpty = d.feeMax.trim() === '';
  if (minEmpty !== maxEmpty) {
    return { error: 'Fill in both ends of the range the app may choose from, or leave both empty.' };
  }
  const feeMin = minEmpty ? null : Number(d.feeMin);
  const feeMax = maxEmpty ? null : Number(d.feeMax);
  if (badPct(feeMin) || badPct(feeMax)) return { error: 'The allowed fee range must be between 0 and 100.' };
  if (feeMin != null && feeMax != null && feeMin > feeMax) {
    return { error: "The lowest allowed fee can't be higher than the highest." };
  }
  return { fee, minPayout, feeMin, feeMax };
}

function defaultsDraft(d: MarketplaceDefaults): RowDraft {
  return {
    enabled: d.enabled,
    feePercent: d.feePercent == null ? '' : String(d.feePercent),
    minPayout: minorToPesoInput(d.minPayout),
    feeMin: d.feeMinPercent == null ? '' : String(d.feeMinPercent),
    feeMax: d.feeMaxPercent == null ? '' : String(d.feeMaxPercent),
  };
}

function DefaultsCard() {
  const q = useFetch(() => api.marketplace.defaults(), []);
  const [draft, setDraft] = React.useState<RowDraft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => { if (q.data) setDraft(defaultsDraft(q.data)); }, [q.data]);

  const patch = (p: Partial<RowDraft>) => {
    setDraft((d) => (d ? { ...d, ...p } : d));
    setMsg(null);
  };

  const dirty = (() => {
    if (!draft || !q.data) return false;
    const o = defaultsDraft(q.data);
    return (Object.keys(o) as (keyof RowDraft)[]).some((k) => o[k] !== draft[k]);
  })();

  const save = async () => {
    if (!draft) return;
    const parsed = parseDraft(draft);
    if ('error' in parsed) { setMsg({ ok: false, text: parsed.error }); return; }
    setSaving(true);
    try {
      await api.marketplace.updateDefaults({
        enabled: draft.enabled,
        feePercent: parsed.fee,
        feeMinPercent: parsed.feeMin,
        feeMaxPercent: parsed.feeMax,
        ...(parsed.minPayout !== undefined ? { minPayout: parsed.minPayout } : {}),
      });
      setMsg({ ok: true, text: 'Defaults saved' });
      q.refetch();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const small = { ...inputStyle, padding: '6px 9px', fontSize: 12.5 };

  return (
    <Card padding={0} style={{ marginBottom: 22 }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Defaults for new apps</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>
          New apps start with these settings. Each app gets its own copy when it&apos;s registered — changing
          these later does NOT change apps that already exist (e.g. BooklyPH keeps its 12%).
        </div>
      </div>
      {q.error && <div style={{ padding: 16 }}><ErrorBlock error={q.error} onRetry={q.refetch} /></div>}
      {!q.error && !draft && <LoadingBlock height={90} />}
      {draft && (
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-end', gap: 22, flexWrap: 'wrap' }}>
          <Field label="Marketplace">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12.5, height: 31 }}>
              <input type="checkbox" checked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
              On by default
            </label>
          </Field>
          <Field label="Platform fee">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input value={draft.feePercent} onChange={(e) => patch({ feePercent: e.target.value })}
                placeholder="e.g. 12" inputMode="decimal" style={{ ...small, width: 80 }} />
              <span style={{ color: 'var(--muted)' }}>%</span>
            </span>
          </Field>
          <Field label="Minimum payout">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--muted)' }}>₱</span>
              <input value={draft.minPayout} onChange={(e) => patch({ minPayout: e.target.value })}
                placeholder="e.g. 500" inputMode="decimal" style={{ ...small, width: 100 }} />
            </span>
          </Field>
          <Field label="App may set fee">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
              from
              <input value={draft.feeMin} onChange={(e) => patch({ feeMin: e.target.value })}
                placeholder="—" inputMode="decimal" style={{ ...small, width: 60, padding: '6px 8px' }} />
              % to
              <input value={draft.feeMax} onChange={(e) => patch({ feeMax: e.target.value })}
                placeholder="—" inputMode="decimal" style={{ ...small, width: 60, padding: '6px 8px' }} />
              %
            </span>
          </Field>
          <div style={{ flex: 1 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            {msg && (
              <span style={{ fontSize: 11.5, color: msg.ok ? 'var(--ok)' : 'var(--bad)', maxWidth: 280, textAlign: 'right' }}>
                {msg.text}
              </span>
            )}
            <Button variant={dirty ? 'primary' : 'secondary'} size="sm" disabled={saving || !dirty} onClick={save}>
              {saving ? 'Saving…' : 'Save defaults'}
            </Button>
          </span>
        </div>
      )}
      {q.data?.updatedBy && (
        <div style={{ padding: '0 16px 12px', fontSize: 11, color: 'var(--muted)' }}>
          Last changed by {q.data.updatedBy}{q.data.updatedAt ? ` on ${formatDateTime(q.data.updatedAt)}` : ''}
        </div>
      )}
    </Card>
  );
}

export function MarketplacePage({ onNavigate }: { onNavigate: Navigate }) {
  const settings = useFetch(() => api.marketplace.settings(), []);
  const summary = useFetch(() => api.marketplace.summary(), []);

  const [rows, setRows] = React.useState<MarketplaceSettingsRow[]>([]);
  const [drafts, setDrafts] = React.useState<Record<string, RowDraft>>({});
  const [saving, setSaving] = React.useState<string | null>(null);
  const [rowMsg, setRowMsg] = React.useState<Record<string, { ok: boolean; text: string }>>({});
  const [historyKey, setHistoryKey] = React.useState(0);

  React.useEffect(() => {
    if (!settings.data) return;
    setRows(settings.data.data);
    setDrafts(Object.fromEntries(settings.data.data.map((r) => [r.appId, draftFrom(r)])));
  }, [settings.data]);

  const patchDraft = (appId: string, patch: Partial<RowDraft>) => {
    setDrafts((d) => ({ ...d, [appId]: { ...d[appId], ...patch } }));
    setRowMsg((m) => {
      const next = { ...m };
      delete next[appId];
      return next;
    });
  };

  const save = async (row: MarketplaceSettingsRow) => {
    const d = drafts[row.appId];
    if (!d) return;
    const parsed = parseDraft(d);
    if ('error' in parsed) {
      setRowMsg((m) => ({ ...m, [row.appId]: { ok: false, text: parsed.error } }));
      return;
    }
    const { fee, minPayout, feeMin, feeMax } = parsed;
    setSaving(row.appId);
    try {
      const updated = await api.marketplace.updateSettings(row.appId, {
        enabled: d.enabled,
        feePercent: fee,
        feeMinPercent: feeMin,
        feeMaxPercent: feeMax,
        ...(minPayout !== undefined ? { minPayout } : {}),
      });
      setRows((rs) => rs.map((r) => (r.appId === row.appId ? updated : r)));
      setDrafts((ds) => ({ ...ds, [row.appId]: draftFrom(updated) }));
      setRowMsg((m) => ({ ...m, [row.appId]: { ok: true, text: 'Saved' } }));
      summary.refetch();
      setHistoryKey((k) => k + 1);
    } catch (err) {
      setRowMsg((m) => ({ ...m, [row.appId]: { ok: false, text: err instanceof Error ? err.message : 'Save failed' } }));
    } finally {
      setSaving(null);
    }
  };

  const isDirty = (row: MarketplaceSettingsRow) => {
    const d = drafts[row.appId];
    if (!d) return false;
    const o = draftFrom(row);
    return d.enabled !== o.enabled || d.feePercent !== o.feePercent || d.minPayout !== o.minPayout
      || d.feeMin !== o.feeMin || d.feeMax !== o.feeMax;
  };

  const enabledSummaries = (summary.data?.apps ?? []).filter((a) => a.marketplaceEnabled);

  return (
    <PageShell
      title="Marketplace"
      breadcrumbs={[{ label: 'Marketplace' }, { label: 'Settings' }]}
      actions={
        <>
          <Button variant="secondary" size="md" onClick={() => onNavigate('merchants')}>Merchants</Button>
          <Button variant="primary" size="md" onClick={() => onNavigate('payouts')}>Payouts</Button>
        </>
      }
    >
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6, marginBottom: 16, maxWidth: 760 }}>
        Marketplace payments let an app collect money on behalf of its merchants (for example, a
        venue on BooklyPH). AcePay keeps a platform fee from each payment and pays the rest out to
        the merchant. Each app sets its own fee — there&apos;s no global default. BooklyPH uses 12%.
      </div>

      <DefaultsCard />

      <Card padding={0} style={{ marginBottom: 22 }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--hairline)' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Settings per app</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
            Turn marketplace payments on, set the fee AcePay keeps, and the smallest amount worth paying out.
            Balances under the minimum just roll over to the next payout run.
            For &quot;App may set fee&quot;: leave empty to keep the fee operator-only. If set, BooklyPH can
            change its own fee within this range from its own system.
          </div>
        </div>
        {settings.error && <div style={{ padding: 16 }}><ErrorBlock error={settings.error} onRetry={settings.refetch} /></div>}
        {!settings.data && settings.loading && <LoadingBlock height={140} />}
        {settings.data && rows.length === 0 && (
          <div style={{ padding: 16, color: 'var(--muted)', fontSize: 12 }}>No apps registered yet.</div>
        )}
        {settings.data && rows.length > 0 && (
          <Table<MarketplaceSettingsRow>
            columns={[
              { key: 'app', label: 'App', render: (r) => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <AppAvatar name={r.appName} size={20} />
                  <span>
                    <div style={{ fontWeight: 550 }}>{r.appName}</div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{r.appSlug}</div>
                  </span>
                </span>
              )},
              { key: 'enabled', label: 'Marketplace', render: (r) => {
                const d = drafts[r.appId];
                return (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12.5 }}>
                    <input
                      type="checkbox"
                      checked={d?.enabled ?? false}
                      onChange={(e) => patchDraft(r.appId, { enabled: e.target.checked })}
                    />
                    {d?.enabled ? 'On' : 'Off'}
                  </label>
                );
              }},
              { key: 'fee', label: 'Platform fee', render: (r) => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    value={drafts[r.appId]?.feePercent ?? ''}
                    onChange={(e) => patchDraft(r.appId, { feePercent: e.target.value })}
                    placeholder="e.g. 12"
                    inputMode="decimal"
                    style={{ ...inputStyle, width: 80, padding: '6px 9px', fontSize: 12.5 }}
                  />
                  <span style={{ color: 'var(--muted)' }}>%</span>
                </span>
              )},
              { key: 'min', label: 'Minimum payout', render: (r) => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: 'var(--muted)' }}>₱</span>
                  <input
                    value={drafts[r.appId]?.minPayout ?? ''}
                    onChange={(e) => patchDraft(r.appId, { minPayout: e.target.value })}
                    placeholder="e.g. 500"
                    inputMode="decimal"
                    style={{ ...inputStyle, width: 100, padding: '6px 9px', fontSize: 12.5 }}
                  />
                </span>
              )},
              { key: 'bounds', label: 'App may set fee', render: (r) => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
                  from
                  <input
                    value={drafts[r.appId]?.feeMin ?? ''}
                    onChange={(e) => patchDraft(r.appId, { feeMin: e.target.value })}
                    placeholder="—"
                    inputMode="decimal"
                    title="Leave both empty to keep the fee operator-only"
                    style={{ ...inputStyle, width: 60, padding: '6px 8px', fontSize: 12.5 }}
                  />
                  % to
                  <input
                    value={drafts[r.appId]?.feeMax ?? ''}
                    onChange={(e) => patchDraft(r.appId, { feeMax: e.target.value })}
                    placeholder="—"
                    inputMode="decimal"
                    title="Leave both empty to keep the fee operator-only"
                    style={{ ...inputStyle, width: 60, padding: '6px 8px', fontSize: 12.5 }}
                  />
                  %
                </span>
              )},
              { key: 'save', label: '', align: 'right', render: (r) => {
                const msg = rowMsg[r.appId];
                return (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
                    {msg && (
                      <span style={{ fontSize: 11.5, color: msg.ok ? 'var(--ok)' : 'var(--bad)', whiteSpace: 'normal', maxWidth: 260, textAlign: 'right' }}>
                        {msg.text}
                      </span>
                    )}
                    <Button
                      variant={isDirty(r) ? 'primary' : 'secondary'}
                      size="sm"
                      disabled={saving === r.appId || !isDirty(r)}
                      onClick={() => save(r)}
                    >
                      {saving === r.appId ? 'Saving…' : 'Save'}
                    </Button>
                  </span>
                );
              }},
            ]}
            rows={rows}
            getRowKey={(r) => r.appId}
          />
        )}
      </Card>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', letterSpacing: 0.2, textTransform: 'uppercase' }}>
          Summary
        </h3>
        {summary.data && (
          <span style={{ fontSize: 11.5, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="clock" size={12} />
            {formatAmount(summary.data.payoutFeeReserve, 'PHP')} is left in each merchant&apos;s balance to cover Xendit&apos;s payout fee
          </span>
        )}
      </div>
      {summary.error && <ErrorBlock error={summary.error} onRetry={summary.refetch} />}
      {!summary.data && summary.loading && <LoadingBlock height={120} />}
      {summary.data && enabledSummaries.length === 0 && (
        <Card padding={16}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            No app has marketplace payments turned on yet. Tick &quot;Marketplace&quot; for an app above, set its fee, and save.
          </div>
        </Card>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 14 }}>
        {enabledSummaries.map((a) => <AppSummaryCard key={a.appId} app={a} />)}
      </div>

      <ChangeHistory apps={rows} refreshKey={historyKey} />
    </PageShell>
  );
}

const MERCHANT_STATUSES: MerchantStatus[] = ['active', 'pending', 'paused', 'suspended'];

function AppSummaryCard({ app }: { app: MarketplaceAppSummary }) {
  const totalMerchants = MERCHANT_STATUSES.reduce((sum, s) => sum + (app.merchants[s] ?? 0), 0);
  const revenue = app.revenue.length > 0 ? app.revenue : [{ currency: 'PHP', gross: 0, platformFees: 0, payments: 0 }];
  return (
    <Card
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <AppAvatar name={app.appName} size={18} />{app.appName}
        </span>
      }
      subtitle={`${app.feePercent ?? '—'}% platform fee · minimum payout ${formatAmount(app.minPayout, 'PHP')}`}
    >
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 6 }}>
            Merchants · {totalMerchants}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {MERCHANT_STATUSES.filter((s) => (app.merchants[s] ?? 0) > 0).map((s) => (
              <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <StatusBadge status={s} size="sm" />
                <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{app.merchants[s]}</span>
              </span>
            ))}
            {totalMerchants === 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>None yet</span>}
          </div>
        </div>
        {revenue.map((r) => (
          <div key={r.currency} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            <DetailMicro label={`Collected (${r.payments} payments)`} value={
              <span className="mono" style={{ fontSize: 16, fontWeight: 600 }}>{formatAmount(r.gross, r.currency)}</span>
            } />
            <DetailMicro label="Platform fees earned" value={
              <span className="mono" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ok)' }}>{formatAmount(r.platformFees, r.currency)}</span>
            } />
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          <DetailMicro label="Paid out to merchants" value={
            <span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{formatAmount(app.paidOut, 'PHP')}</span>
          } />
          <DetailMicro label="On the way (in flight)" value={
            <span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{formatAmount(app.payoutsInFlight, 'PHP')}</span>
          } />
        </div>
      </div>
    </Card>
  );
}

// ─── Change history ─────────────────────────────────────────────────────

const FIELD_LABEL: Record<MarketplaceConfigField, string> = {
  marketplace_enabled: 'Marketplace on/off',
  marketplace_fee_percent: 'Platform fee',
  marketplace_min_payout: 'Minimum payout',
  marketplace_fee_min_percent: 'Lowest allowed fee',
  marketplace_fee_max_percent: 'Highest allowed fee',
};

function formatConfigValue(field: MarketplaceConfigField, v: unknown): string {
  if (v === null || v === undefined || v === '') {
    return field === 'marketplace_fee_min_percent' || field === 'marketplace_fee_max_percent' ? 'Not set' : '—';
  }
  if (field === 'marketplace_enabled') {
    const on = v === true || v === 'true' || v === 1;
    return on ? 'On' : 'Off';
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (field === 'marketplace_min_payout') return formatAmount(n, 'PHP');
  return `${n}%`;
}

const HISTORY_PAGE_SIZE = 15;

function ChangeHistory({ apps, refreshKey }: { apps: MarketplaceSettingsRow[]; refreshKey: number }) {
  const [appFilter, setAppFilter] = React.useState('All');
  const [page, setPage] = React.useState(1);
  const query = {
    page, pageSize: HISTORY_PAGE_SIZE,
    appId: appFilter !== 'All' ? appFilter : undefined,
  };
  const list = useFetch(() => api.marketplace.configChanges(query), [JSON.stringify(query), refreshKey]);
  const appName = (id: string) => apps.find((a) => a.appId === id)?.appName;

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', letterSpacing: 0.2, textTransform: 'uppercase' }}>
            Change history
          </h3>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>
            Every change to these settings, newest first. Changes an app made itself are highlighted.
          </div>
        </div>
        <FilterSelect label="App" value={appFilter} onChange={(v) => { setAppFilter(v); setPage(1); }}
          options={['All', ...apps.map((a) => ({ value: a.appId, label: a.appName }))]} />
      </div>
      <Card padding={0}>
        {!list.data && list.loading && <LoadingBlock height={120} />}
        {list.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{list.error.message}</div>}
        {list.data && list.data.data.length === 0 && (
          <div style={{ padding: 16, color: 'var(--muted)', fontSize: 12 }}>No changes recorded yet.</div>
        )}
        {list.data && list.data.data.length > 0 && (
          <>
            <Table<MarketplaceConfigChange>
              dense
              columns={[
                { key: 'when', label: 'When', render: (r) => (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {r.actor === 'app' && <span style={{ width: 3, height: 18, borderRadius: 2, background: 'var(--warn)' }} />}
                    <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{formatDateTime(r.createdAt)}</span>
                  </span>
                )},
                { key: 'app', label: 'App', render: (r) => {
                  const name = r.app?.name ?? appName(r.appId) ?? '—';
                  return (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      <AppAvatar name={name} size={16} />{name}
                    </span>
                  );
                }},
                { key: 'who', label: 'Who', render: (r) => (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <span style={{
                      padding: '2px 7px', borderRadius: 4, fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap',
                      background: r.actor === 'app' ? 'var(--warn-soft)' : 'var(--neutral-soft)',
                      color: r.actor === 'app' ? 'var(--warn)' : 'var(--ink-2)',
                    }}>
                      {r.actor === 'app' ? 'App (API key)' : 'AcePay admin'}
                    </span>
                    {r.actorRef && <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{r.actorRef}</span>}
                  </span>
                )},
                { key: 'what', label: 'What changed', render: (r) => (
                  <span style={{ fontWeight: 550 }}>{FIELD_LABEL[r.field] ?? r.field}</span>
                )},
                { key: 'change', label: 'Change', render: (r) => (
                  <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ color: 'var(--muted)' }}>{formatConfigValue(r.field, r.oldValue)}</span>
                    <Icon name="arrow" size={11} color="var(--muted-2)" />
                    <span style={{ fontWeight: 600 }}>{formatConfigValue(r.field, r.newValue)}</span>
                  </span>
                )},
              ]}
              rows={list.data.data}
              getRowKey={(r) => r.id}
            />
            <Pager total={list.data.total} page={list.data.page} pageSize={list.data.pageSize} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
