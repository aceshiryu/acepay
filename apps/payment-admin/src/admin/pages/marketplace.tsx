'use client';

import React from 'react';
import * as api from '../api/client';
import { formatAmount } from '../api/format';
import { ErrorBlock, LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { MarketplaceAppSummary, MarketplaceSettingsRow, MerchantStatus } from '../api/types';
import { PageShell } from '../layout';
import { AppAvatar, Button, Card, Icon, StatusBadge, Table } from '../primitives';
import { DetailMicro, inputStyle } from '../shared';
import { Navigate } from '../types';

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
}

function draftFrom(row: MarketplaceSettingsRow): RowDraft {
  return {
    enabled: row.marketplaceEnabled,
    feePercent: row.feePercent == null ? '' : String(row.feePercent),
    minPayout: minorToPesoInput(row.minPayout),
  };
}

export function MarketplacePage({ onNavigate }: { onNavigate: Navigate }) {
  const settings = useFetch(() => api.marketplace.settings(), []);
  const summary = useFetch(() => api.marketplace.summary(), []);

  const [rows, setRows] = React.useState<MarketplaceSettingsRow[]>([]);
  const [drafts, setDrafts] = React.useState<Record<string, RowDraft>>({});
  const [saving, setSaving] = React.useState<string | null>(null);
  const [rowMsg, setRowMsg] = React.useState<Record<string, { ok: boolean; text: string }>>({});

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
    const fee = d.feePercent.trim() === '' ? null : Number(d.feePercent);
    if (fee != null && (!Number.isFinite(fee) || fee < 0 || fee > 100)) {
      setRowMsg((m) => ({ ...m, [row.appId]: { ok: false, text: 'Fee must be a number between 0 and 100.' } }));
      return;
    }
    const minPayout = d.minPayout.trim() === '' ? undefined : pesosToMinor(d.minPayout);
    if (minPayout === null) {
      setRowMsg((m) => ({ ...m, [row.appId]: { ok: false, text: 'Minimum payout must be a peso amount, like 500.' } }));
      return;
    }
    setSaving(row.appId);
    try {
      const updated = await api.marketplace.updateSettings(row.appId, {
        enabled: d.enabled,
        feePercent: fee,
        ...(minPayout !== undefined ? { minPayout } : {}),
      });
      setRows((rs) => rs.map((r) => (r.appId === row.appId ? updated : r)));
      setDrafts((ds) => ({ ...ds, [row.appId]: draftFrom(updated) }));
      setRowMsg((m) => ({ ...m, [row.appId]: { ok: true, text: 'Saved' } }));
      summary.refetch();
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
    return d.enabled !== o.enabled || d.feePercent !== o.feePercent || d.minPayout !== o.minPayout;
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

      <Card padding={0} style={{ marginBottom: 22 }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--hairline)' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Settings per app</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
            Turn marketplace payments on, set the fee AcePay keeps, and the smallest amount worth paying out.
            Balances under the minimum just roll over to the next payout run.
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
