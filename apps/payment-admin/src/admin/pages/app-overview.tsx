'use client';

import React from 'react';
import Link from 'next/link';
import * as api from '../api/client';
import { formatAmountCompact, formatRelative, pickPrimary } from '../api/format';
import { LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { AppView, Provider } from '../api/types';
import { ALWAYS_SHOWN, allAppMenuItems, appPath, primaryProvider, scopeCrumbs, useAppScope } from '../app-scope';
import { notifyAppsChanged } from '../events';
import { HEALTH_DOT, PageShell } from '../layout';
import { Button, Card, Icon, KV, StatusBadge, Table, TypePill } from '../primitives';
import { providerTheme } from '../provider-theme';
import { Field, Modal, StatCard, inputStyle } from '../shared';
import { Navigate } from '../types';
import { AppPaymentMethodsCard } from './app-payment-methods';
import {
  AppSettingsCard, ArchiveAppModal, DeactivateAppModal, DeleteAppPermanentlyModal, MetaTag, TestTransactionForm,
} from './apps';
import { draftFrom, parseDraft, RowDraft } from './marketplace';

// ─── Overview ──────────────────────────────────────────────────────────────

/** /apps/<id>: status + checklist, headline numbers, recent transactions. */
export function AppOverviewPage({ onNavigate }: { onNavigate: Navigate }) {
  const scope = useAppScope();
  const app = scope!.app;
  const status = useFetch(() => api.apps.status(app.id), [app.id, app.updatedAt]);
  const summary = useFetch(() => api.stats.app(app.id), [app.id]);
  const tx = useFetch(() => api.transactions.list({ appId: app.id, pageSize: 5 }), [app.id]);
  const plans = useFetch(() => api.plans.list({ appId: app.id, pageSize: 50 }), [app.id]);
  const [testOpen, setTestOpen] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);
  const theme = providerTheme(scope!.provider);
  // One-time payments: PayMongo apps that aren't in marketplace mode.
  const canTestPayment = scope!.provider === 'paymongo' && !app.marketplaceEnabled;
  const hasPlans = (plans.data?.data ?? []).some((p) => p.isActive);

  return (
    <PageShell
      title="Overview"
      subtitle={`${app.name} on ${theme?.label ?? 'no provider yet'}`}
      breadcrumbs={scopeCrumbs(scope!, 'Overview')}
      actions={
        <>
          <Button variant="secondary" size="md" leading={<Icon name="apps" size={12} />} onClick={() => onNavigate('integrate')}>
            Integration guide
          </Button>
          {canTestPayment && (
            <Button
              variant="primary" size="md" leading={<Icon name="play" size={12} />}
              onClick={() => setPayOpen(true)}
              disabled={!app.isActive}
              title={app.isActive ? 'Create a one-time test payment and open its checkout' : 'Activate the app first'}
            >
              Run test payment
            </Button>
          )}
          {(hasPlans || !canTestPayment) && (
            <Button
              variant={canTestPayment ? 'secondary' : 'primary'} size="md" leading={<Icon name="play" size={12} />}
              onClick={() => setTestOpen(true)}
              disabled={!app.isActive}
              title={app.isActive ? 'Create a sandbox subscription to test the full flow' : 'Activate the app first'}
            >
              Run test subscription
            </Button>
          )}
        </>
      }
    >
      {status.loading && !status.data && <LoadingBlock height={120} />}
      {status.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{status.error.message}</div>}
      {status.data && <StatusPanel appId={app.id} status={status.data} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, margin: '18px 0' }}>
        <StatCard label="Total transactions" value={summary.data?.txCount ?? '…'} sub="all-time" accent="var(--accent)" />
        <StatCard
          label="Success rate"
          value={summary.data?.successRate != null ? `${summary.data.successRate}%` : '—'}
          sub="last 30 days" accent="var(--ok)"
        />
        <StatCard
          label="Total volume"
          value={(() => {
            const r = summary.data ? pickPrimary(summary.data.revenue) : null;
            return r ? formatAmountCompact(r.amount, r.currency) : '—';
          })()}
          sub="net of refunds" accent="var(--accent)"
        />
        <StatCard label="Active subscriptions" value={summary.data?.activeSubs ?? '…'} sub="recurring" accent="var(--ok)" />
      </div>

      <Card padding={0}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--hairline)' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Recent transactions</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>Last 5 for {app.name}</div>
          </div>
          <button onClick={() => onNavigate('transactions')} style={{
            background: 'none', border: 'none', fontSize: 12, color: 'var(--accent-text)', fontWeight: 550,
            display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
          }}>View all <Icon name="arrow" size={11} strokeWidth={2} /></button>
        </div>
        {tx.loading && !tx.data && <LoadingBlock height={120} />}
        {tx.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{tx.error.message}</div>}
        {tx.data && tx.data.data.length === 0 && (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>
            No transactions yet.
          </div>
        )}
        {tx.data && tx.data.data.length > 0 && (
          <Table
            dense
            columns={[
              { key: 'id', label: 'ID', render: (r) => <span className="mono" style={{ color: 'var(--accent-text)' }}>{r.code}</span> },
              { key: 'customer', label: 'Customer', render: (r) => r.customer?.email ?? '—' },
              { key: 'type', label: 'Type', render: (r) => <TypePill type={r.type === 'subscription_payment' ? 'subscription' : r.type} /> },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="mono" style={{ fontWeight: 600 }}>{formatAmountCompact(r.amount, r.currency)}</span> },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} size="sm" /> },
              { key: 'created', label: 'Created', align: 'right', render: (r) => <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{formatRelative(r.createdAt)}</span> },
            ]}
            rows={tx.data.data}
            getRowKey={(r) => r.id}
            onRowClick={(r) => onNavigate('transaction-detail', r.id)}
          />
        )}
      </Card>

      {payOpen && (
        <Modal title={`Run test payment · ${app.name}`} onClose={() => { setPayOpen(false); tx.refetch(); }} width={480}>
          <TestPaymentForm appId={app.id} onDone={() => tx.refetch()} />
        </Modal>
      )}

      {testOpen && (
        <Modal title={`Run test transaction · ${app.name}`} onClose={() => setTestOpen(false)} width={560}>
          <TestTransactionForm
            appId={app.id}
            plans={plans.data?.data.filter((p) => p.isActive) ?? []}
            onClose={() => setTestOpen(false)}
            onNavigate={onNavigate}
          />
        </Modal>
      )}
    </PageShell>
  );
}

/** One-time test payment: creates it, then links to PayMongo's checkout. */
function TestPaymentForm({ appId, onDone }: { appId: string; onDone: () => void }) {
  const [amount, setAmount] = React.useState('100');
  const [email, setEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ code: string; checkoutUrl: string | null } | null>(null);

  const submit = async () => {
    setError(null);
    const pesos = Number(amount);
    if (!Number.isFinite(pesos) || pesos < 1) { setError('Enter an amount of at least ₱1.'); return; }
    setBusy(true);
    try {
      const r = await api.apps.testPayment(appId, {
        amount: Math.round(pesos * 100),
        customerEmail: email.trim() || undefined,
        redirect: `${window.location.origin}${appPath(appId, 'payments')}`,
      });
      setResult({ code: r.code, checkoutUrl: r.checkoutUrl });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the payment');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
        <div>
          Created <span className="mono" style={{ fontWeight: 600 }}>{result.code}</span>. Open the checkout and pay with a
          PayMongo test card. When PayMongo confirms, it turns <strong>Succeeded</strong> under Payments.
        </div>
        {result.checkoutUrl && (
          <a href={result.checkoutUrl} target="_blank" rel="noreferrer" data-testid="test-checkout-link">
            <Button variant="primary">Open PayMongo checkout ↗</Button>
          </a>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field label="Amount (₱)" hint="PayMongo test mode — no real money moves">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="1" step="0.01" className="mono" style={inputStyle} />
      </Field>
      <Field label="Customer email (optional)" hint="Pre-fills the checkout">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="buyer@example.com" style={inputStyle} />
      </Field>
      {error && <div style={{ background: 'var(--bad-soft)', color: 'var(--bad)', padding: '8px 10px', borderRadius: 6, fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create test payment'}</Button>
      </div>
    </div>
  );
}

const STATUS_COPY: Record<keyof typeof HEALTH_DOT, { title: string; body: string; bg: string; fg: string }> = {
  live:            { title: 'Live', body: 'Everything checks out. This app can take payments.', bg: 'var(--ok-soft)', fg: 'var(--ok)' },
  needs_attention: { title: 'Needs attention', body: 'Payments work, but something below needs a look.', bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  not_ready:       { title: 'Not ready', body: 'Payments can’t go through until the items marked below are fixed.', bg: 'var(--bad-soft)', fg: 'var(--bad)' },
  inactive:        { title: 'Inactive', body: 'This app is turned off. Its API key is rejected until you activate it in App settings.', bg: 'var(--neutral-soft)', fg: 'var(--ink-2)' },
};

function StatusPanel({ appId, status }: { appId: string; status: api.AppStatusResponse }) {
  const copy = STATUS_COPY[status.status];
  return (
    <Card padding={0}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
        background: copy.bg, borderTopLeftRadius: 'var(--radius)', borderTopRightRadius: 'var(--radius)',
      }}>
        <span style={{ width: 12, height: 12, borderRadius: 12, background: HEALTH_DOT[status.status].color, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: copy.fg }}>{copy.title}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 1 }}>{copy.body}</div>
        </div>
      </div>
      <div style={{ padding: '6px 18px 10px' }}>
        {status.checks.map((c, i) => (
          <div key={c.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
            borderBottom: i < status.checks.length - 1 ? '1px solid var(--hairline)' : 'none',
          }}>
            <span style={{
              width: 20, height: 20, borderRadius: 20, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: c.ok ? 'var(--ok-soft)' : c.blocking ? 'var(--bad-soft)' : 'var(--warn-soft)',
            }}>
              <Icon name={c.ok ? 'check' : c.blocking ? 'x' : 'warn'} size={11} strokeWidth={2.4}
                color={c.ok ? 'var(--ok)' : c.blocking ? 'var(--bad)' : 'var(--warn)'} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 550, color: 'var(--ink)' }}>{c.label}</div>
              {c.detail && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{c.detail}</div>}
            </div>
            {!c.ok && c.fix && (
              <Link href={appPath(appId, c.fix)} style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-text)', whiteSpace: 'nowrap' }}>
                Fix →
              </Link>
            )}
            {!c.ok && c.id === 'provider_configured' && !c.fix && (
              <ProviderFixLink detail={c.detail} />
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ProviderFixLink({ detail }: { detail: string | null }) {
  const scope = useAppScope();
  const p = scope ? primaryProvider(scope.app) : null;
  if (!p) return null;
  return (
    <Link href={`/providers/${p}`} title={detail ?? undefined} style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-text)', whiteSpace: 'nowrap' }}>
      Set up →
    </Link>
  );
}

// ─── App settings ──────────────────────────────────────────────────────────

/** /apps/<id>/settings: keys, webhook (with test ping), metadata, payment methods, marketplace, on/off. */
export function AppSettingsPage({ onNavigate }: { onNavigate: Navigate }) {
  const scope = useAppScope()!;
  const app = scope.app;
  const provider = scope.provider ?? primaryProvider(app);
  const [deactivateOpen, setDeactivateOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const changed = () => { scope.reload(); notifyAppsChanged(); };
  const archived = !!app.archivedAt;

  return (
    <PageShell
      title="App settings"
      breadcrumbs={scopeCrumbs(scope, 'App settings')}
      actions={archived ? undefined : (
        <Button variant="secondary" size="md" onClick={() => setDeactivateOpen(true)}>
          {app.isActive ? 'Deactivate' : 'Activate'}
        </Button>
      )}
    >
      {archived && (
        <div style={{
          marginBottom: 16, padding: '12px 14px', borderRadius: 8,
          background: 'var(--warn-soft)', color: 'var(--ink-2)', fontSize: 12.5, lineHeight: 1.55,
        }}>
          <strong>This app is archived{app.archivedAt ? ` (${formatRelative(app.archivedAt)})` : ''}.</strong>{' '}
          It's hidden from every list and its API key is rejected. Restore it or delete it permanently in the
          Danger Zone below.
        </div>
      )}
      {actionError && <div style={{ marginBottom: 12, color: 'var(--bad)', fontSize: 12 }}>{actionError}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
        <CredentialsCard app={app} onChanged={changed} />
        <Card title="Input requirements" subtitle="Metadata schema enforced on every payment" padding={0}>
          <div style={{ padding: '12px 16px 14px' }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Required</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {app.requiredMetadata.map((k) => <MetaTag key={k} label={k} />)}
                {app.requiredMetadata.length === 0 && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>none</span>}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Optional</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {app.optionalMetadata.map((k) => <MetaTag key={k} label={k} optional />)}
                {app.optionalMetadata.length === 0 && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>none</span>}
              </div>
            </div>
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
              <KV k="Code" v={<span className="mono">{app.code}</span>} />
              <KV k="Slug" v={<span className="mono">{app.slug}</span>} />
              <KV k="Created" v={formatRelative(app.createdAt)} />
            </div>
          </div>
        </Card>
      </div>

      <AppMenusCard app={app} provider={provider} onSaved={changed} />

      {provider === 'xendit' && <AppPaymentMethodsCard app={app} onSaved={changed} />}
      {provider === 'xendit' && <AppMarketplaceCard app={app} onSaved={changed} onNavigate={onNavigate} />}

      <AppSettingsCard
        app={app}
        onSaved={changed}
        onArchive={() => setArchiveOpen(true)}
        onDeletePermanently={() => setDeleteOpen(true)}
        onRestore={async () => {
          setActionError(null);
          try { await api.apps.restore(app.id); changed(); }
          catch (err) { setActionError(err instanceof Error ? err.message : 'Could not restore'); }
        }}
      />

      {deactivateOpen && (
        <DeactivateAppModal
          appName={app.name}
          isActive={app.isActive}
          onClose={() => setDeactivateOpen(false)}
          onConfirm={async () => {
            if (app.isActive) await api.apps.deactivate(app.id);
            else await api.apps.activate(app.id);
            setDeactivateOpen(false);
            changed();
          }}
        />
      )}
      {archiveOpen && (
        <ArchiveAppModal
          appName={app.name}
          onClose={() => setArchiveOpen(false)}
          onConfirm={async () => {
            await api.apps.archive(app.id);
            setArchiveOpen(false);
            notifyAppsChanged();
            // It's no longer in the sidebar; land on the Apps page.
            onNavigate('apps');
          }}
        />
      )}
      {deleteOpen && (
        <DeleteAppPermanentlyModal
          appName={app.name}
          onClose={() => setDeleteOpen(false)}
          onConfirm={async (confirmName) => {
            await api.apps.deletePermanently(app.id, confirmName);
            setDeleteOpen(false);
            notifyAppsChanged();
            onNavigate('apps');
          }}
        />
      )}
    </PageShell>
  );
}

/** Which inner-sidebar items this app shows. Hiding never deletes data. */
function AppMenusCard({ app, provider, onSaved }: { app: AppView; provider: Provider | null; onSaved: () => void }) {
  const items = allAppMenuItems(provider, { marketplace: app.marketplaceEnabled })
    .filter((m) => !ALWAYS_SHOWN.includes(m.segment));
  const stored = new Set(app.hiddenMenus ?? []);
  const [hidden, setHidden] = React.useState<Set<string>>(stored);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => setHidden(new Set(app.hiddenMenus ?? [])), [app.hiddenMenus]);

  const dirty = hidden.size !== stored.size || [...hidden].some((k) => !stored.has(k));

  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      await api.apps.setMenus(app.id, [...hidden]);
      setMessage({ ok: true, text: 'Saved.' });
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Could not save' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Menu"
      subtitle="Choose which pages show in this app's side menu. Hiding a page doesn't delete anything. Overview and App settings always show."
      padding={0}
      style={{ marginBottom: 16 }}
    >
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          {items.map((m) => (
            <label key={m.segment} data-testid={`menu-${m.segment}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!hidden.has(m.segment)}
                style={{ accentColor: 'var(--accent)' }}
                onChange={() => {
                  setMessage(null);
                  setHidden((prev) => {
                    const next = new Set(prev);
                    if (next.has(m.segment)) next.delete(m.segment); else next.add(m.segment);
                    return next;
                  });
                }}
              />
              <Icon name={m.icon} size={13} color="var(--muted)" />
              {m.label}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <Button variant="primary" size="sm" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save menu'}</Button>
          {message && <span style={{ fontSize: 12, color: message.ok ? 'var(--ok)' : 'var(--bad)' }}>{message.text}</span>}
        </div>
      </div>
    </Card>
  );
}

function CredentialsCard({ app, onChanged }: { app: AppView; onChanged: () => void }) {
  const [ping, setPing] = React.useState<{ ok: boolean; detail: string } | null>(null);
  const [pinging, setPinging] = React.useState(false);
  const last = app.lastPing;

  const sendPing = async () => {
    setPinging(true);
    setPing(null);
    try {
      const r = await api.apps.webhookTest(app.id);
      setPing({ ok: r.ok, detail: r.detail });
      onChanged();
    } catch (err) {
      setPing({ ok: false, detail: err instanceof Error ? err.message : 'Ping failed' });
    } finally {
      setPinging(false);
    }
  };

  return (
    <Card title="Credentials" subtitle="API key and webhook" padding={0}>
      <div style={{ padding: '4px 16px 14px' }}>
        <KV k="API key prefix" v={<span className="mono">{app.apiKeyPrefix}…</span>} />
        <KV k="API key expires" v={app.apiKeyExpiresAt ? new Date(app.apiKeyExpiresAt).toLocaleDateString() : 'never'} />
        <KV k="Webhook URL" v={app.webhookUrl
          ? <span className="mono">{app.webhookUrl}</span>
          : <span style={{ color: 'var(--muted)' }}>not set</span>} />
        <KV k="Last test ping" v={last
          ? <span style={{ color: last.ok ? 'var(--ok)' : 'var(--bad)' }}>{last.ok ? 'OK' : 'Failed'} · {formatRelative(last.at)}</span>
          : <span style={{ color: 'var(--muted)' }}>never</span>} />
        {ping && (
          <div style={{
            marginTop: 8, padding: '8px 10px', borderRadius: 6, fontSize: 11.5,
            background: ping.ok ? 'var(--ok-soft)' : 'var(--bad-soft)', color: ping.ok ? 'var(--ok)' : 'var(--bad)',
          }}>{ping.detail}</div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <Button variant="secondary" size="sm" onClick={sendPing} disabled={!app.webhookUrl || pinging}
            title={app.webhookUrl ? 'Send a signed app.ping to the webhook URL' : 'Set a webhook URL first'}>
            {pinging ? 'Sending…' : 'Send test ping'}
          </Button>
          <Button
            variant="secondary" size="sm"
            onClick={async () => {
              if (!confirm('Rotate the API key? The current one will be rejected immediately.')) return;
              const result = await api.apps.regenerateKey(app.id);
              alert(`New key (saved once):\n\n${result.apiKey}\n\nStore it now.`);
              onChanged();
            }}
          >
            Rotate API key
          </Button>
          <Button
            variant="secondary" size="sm"
            onClick={async () => {
              if (!confirm('Rotate the webhook secret? Update your verifier with the new one.')) return;
              const result = await api.apps.regenerateWebhookSecret(app.id);
              alert(`New webhook secret (saved once):\n\n${result.webhookSecret}\n\nStore it now.`);
              onChanged();
            }}
          >
            Rotate webhook secret
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Single-app version of the Marketplace page's settings row (Xendit apps only). */
function AppMarketplaceCard({ app, onSaved, onNavigate }: { app: AppView; onSaved: () => void; onNavigate: Navigate }) {
  const settings = useFetch(() => api.marketplace.settings(), [app.id]);
  const row = settings.data?.data.find((r) => r.appId === app.id) ?? null;
  const [draft, setDraft] = React.useState<RowDraft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => { if (row) setDraft(draftFrom(row)); }, [row?.appId, row?.feePercent, row?.minPayout, row?.marketplaceEnabled]);

  const set = <K extends keyof RowDraft>(k: K, v: RowDraft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async () => {
    if (!draft) return;
    setMessage(null);
    const parsed = parseDraft(draft);
    if ('error' in parsed) { setMessage({ ok: false, text: parsed.error }); return; }
    if (draft.enabled && parsed.fee == null) {
      setMessage({ ok: false, text: 'Set a fee before turning marketplace mode on.' }); return;
    }
    setSaving(true);
    try {
      await api.marketplace.updateSettings(app.id, {
        enabled: draft.enabled,
        feePercent: parsed.fee,
        minPayout: parsed.minPayout,
        feeMinPercent: parsed.feeMin,
        feeMaxPercent: parsed.feeMax,
      });
      setMessage({ ok: true, text: 'Saved.' });
      settings.refetch();
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Could not save' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Marketplace"
      subtitle="Collect payments for merchants on their own Xendit sub-accounts, keeping a platform fee."
      padding={0}
      style={{ marginBottom: 16 }}
      action={app.marketplaceEnabled ? (
        <Button variant="ghost" size="sm" onClick={() => onNavigate('merchants')}>Merchants →</Button>
      ) : undefined}
    >
      <div style={{ padding: '14px 16px' }}>
        {!draft && <LoadingBlock height={80} />}
        {draft && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 550, marginBottom: 12 }}>
              <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
              Marketplace mode on
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              <Field label="Platform fee %">
                <input value={draft.feePercent} onChange={(e) => set('feePercent', e.target.value)} placeholder="12" className="mono" style={inputStyle} />
              </Field>
              <Field label="App may set from %">
                <input value={draft.feeMin} onChange={(e) => set('feeMin', e.target.value)} placeholder="—" className="mono" style={inputStyle} />
              </Field>
              <Field label="…up to %">
                <input value={draft.feeMax} onChange={(e) => set('feeMax', e.target.value)} placeholder="—" className="mono" style={inputStyle} />
              </Field>
              <Field label="Min payout (₱)">
                <input value={draft.minPayout} onChange={(e) => set('minPayout', e.target.value)} placeholder="500" className="mono" style={inputStyle} />
              </Field>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <Button variant="primary" size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save marketplace settings'}</Button>
              {message && <span style={{ fontSize: 12, color: message.ok ? 'var(--ok)' : 'var(--bad)' }}>{message.text}</span>}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
