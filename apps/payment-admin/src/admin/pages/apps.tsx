'use client';

import React from 'react';
import * as api from '../api/client';
import { formatAmountCompact, formatRelative, pickPrimary } from '../api/format';
import { LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { AppView } from '../api/types';
import { PageShell } from '../layout';
import { Button, Card, Icon, KV, ProviderTag, StatusBadge, Table, AppAvatar, TypePill } from '../primitives';
import { Field, MiniStatCard, Modal, StatCard, inputStyle } from '../shared';
import { LookedUpVariant, Plan } from '../api/types';
import { EditPlanForm, RegisterPlanForm } from './plans';
import { useAuth } from '../auth/auth-context';
import { Navigate } from '../types';

export function AppsPage({ onNavigate }: { onNavigate: Navigate }) {
  const apps = useFetch(() => api.apps.list(), []);
  const appList = apps.data?.data ?? [];

  return (
    <PageShell
      title="Apps"
      breadcrumbs={[{ label: 'Configuration' }, { label: 'Apps' }]}
      actions={
        <Button variant="primary" size="md" leading={<Icon name="plus" size={12} strokeWidth={2.4} />} onClick={() => onNavigate('register-app')}>
          Register App
        </Button>
      }
    >
      <IntegrationBanner onNavigate={onNavigate} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
        <MiniStatCard label="Total Apps" value={appList.length} sub={`${appList.filter((a) => a.isActive).length} active`} />
        <MiniStatCard label="Active" value={appList.filter((a) => a.isActive).length} sub="accepting payments" />
        <MiniStatCard label="Inactive" value={appList.filter((a) => !a.isActive).length} sub="paused" />
        <MiniStatCard label="With webhook URL" value={appList.filter((a) => a.webhookUrl).length} sub="receiving deliveries" />
      </div>

      <Card title="All Apps" padding={0}>
        {apps.loading && <LoadingBlock height={140} />}
        {apps.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{apps.error.message}</div>}
        {apps.data && (
          <Table<AppView>
            columns={[
              { key: 'name', label: 'App', render: (a) => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                  <AppAvatar name={a.name} size={22} />
                  <span>
                    <div style={{ fontWeight: 550, color: 'var(--ink)' }}>{a.name}</div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{a.slug}</div>
                  </span>
                </span>
              ) },
              { key: 'status', label: 'Status', render: (a) => <StatusBadge status={a.isActive ? 'active' : 'inactive'} /> },
              { key: 'webhookUrl', label: 'Webhook', render: (a) => a.webhookUrl
                ? <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{a.webhookUrl}</span>
                : <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>not set</span> },
              { key: 'requiredMetadata', label: 'Required Meta', render: (a) =>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {a.requiredMetadata.length ? a.requiredMetadata.join(', ') : '—'}
                </span> },
              { key: 'rateLimit', label: 'Rate', align: 'right', render: (a) => <span className="mono">{a.rateLimit}/min</span> },
              { key: 'createdAt', label: 'Created', align: 'right', render: (a) => (
                <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{formatRelative(a.createdAt)}</span>
              ) },
            ]}
            rows={appList}
            getRowKey={(r) => r.id}
            onRowClick={(a) => onNavigate('app-detail', a.id)}
          />
        )}
      </Card>
    </PageShell>
  );
}

// ─── App Detail ─────────────────────────────────────────────────────────────

export function AppDetailPage({ appId, onNavigate, onBack }: { appId: string | null; onNavigate: Navigate; onBack: () => void }) {
  const appQ = useFetch(() => api.apps.one(appId!), [appId]);
  const summaryQ = useFetch(() => api.stats.app(appId!), [appId]);
  const txQ = useFetch(() => api.transactions.list({ appId: appId!, pageSize: 5 }), [appId]);
  const plansQ = useFetch(() => api.plans.list({ appId: appId!, pageSize: 20 }), [appId]);
  const [verifyTarget, setVerifyTarget] = React.useState<Plan | null>(null);
  const [editTarget, setEditTarget] = React.useState<Plan | null>(null);
  const [addPlanOpen, setAddPlanOpen] = React.useState(false);
  const [testOpen, setTestOpen] = React.useState(false);

  const [deactivateOpen, setDeactivateOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const settingsAnchor = React.useRef<HTMLDivElement | null>(null);

  if (appQ.loading || !appQ.data) {
    return (
      <PageShell title="App" breadcrumbs={[{ label: 'Apps', onClick: onBack }, { label: '…' }]}>
        <LoadingBlock height={200} />
      </PageShell>
    );
  }
  if (appQ.error) {
    return (
      <PageShell title="App" breadcrumbs={[{ label: 'Apps', onClick: onBack }]}>
        <div style={{ padding: 16, color: 'var(--bad)' }}>{appQ.error.message}</div>
      </PageShell>
    );
  }
  const app = appQ.data;
  const isActive = app.isActive;

  return (
    <PageShell
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <AppAvatar name={app.name} size={28} />
          {app.name}
          <StatusBadge status={isActive ? 'active' : 'inactive'} />
        </span>
      }
      breadcrumbs={[{ label: 'Apps', onClick: onBack }, { label: app.name }]}
      actions={
        <>
          <Button
            variant="secondary" size="md"
            leading={<Icon name="apps" size={12} />}
            onClick={() => onNavigate('integrate')}
          >
            Integration Guide
          </Button>
          <Button
            variant="primary" size="md"
            leading={<Icon name="play" size={12} />}
            onClick={() => setTestOpen(true)}
            disabled={!isActive}
            title={isActive ? 'Create a sandbox subscription to test the full flow' : 'Activate the app first'}
          >
            Run test transaction
          </Button>
          <Button variant="secondary" size="md" onClick={() => setDeactivateOpen(true)}>
            {isActive ? 'Deactivate' : 'Activate'}
          </Button>
          <Button
            variant="secondary" size="md" leading={<Icon name="settings" size={12} />}
            onClick={() => settingsAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            Settings
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
        <StatCard
          label="Total Transactions"
          value={summaryQ.data?.txCount ?? '…'}
          sub="all-time" accent="var(--info)"
          sparkData={[20, 30, 25, 40, 38, 50, 45, 60, 58, 70, 75, 80]}
        />
        <StatCard
          label="Success Rate"
          value={summaryQ.data?.successRate != null ? `${summaryQ.data.successRate}%` : '—'}
          sub="last 30 days" accent="var(--ok)"
          sparkData={[93, 94, 92, 95, 94, 96, 94, 95, 93, 94, 94.2]}
        />
        <StatCard
          label="Total Volume"
          value={(() => {
            const r = summaryQ.data ? pickPrimary(summaryQ.data.revenue) : null;
            return r ? formatAmountCompact(r.amount, r.currency) : '—';
          })()}
          sub="net of refunds" accent="#5851B0"
          sparkData={[5000, 7000, 6000, 9000, 8500, 11000, 10000, 13000, 12500, 15000, 16000]}
        />
        <StatCard
          label="Active Subscriptions"
          value={summaryQ.data?.activeSubs ?? '…'}
          sub="recurring" accent="var(--ok)"
          sparkData={[280, 285, 290, 295, 298, 302, 305, 308, 310, 311, 312]}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
        <Card title="Credentials" subtitle="API key prefix + webhook URL" padding={0}>
          <div style={{ padding: '4px 16px 14px' }}>
            <KV k="API key prefix" v={<span className="mono">{app.apiKeyPrefix}…</span>} />
            <KV k="Webhook URL" v={app.webhookUrl
              ? <span className="mono">{app.webhookUrl}</span>
              : <span style={{ color: 'var(--muted)' }}>not set</span>} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button
                variant="secondary" size="sm"
                onClick={async () => {
                  if (!confirm('Rotate the API key? The current one will be rejected immediately.')) return;
                  const result = await api.apps.regenerateKey(app.id);
                  alert(`New key (saved once):\n\n${result.apiKey}\n\nStore it now.`);
                  appQ.refetch();
                }}
              >
                Rotate API Key
              </Button>
              <Button
                variant="secondary" size="sm"
                onClick={async () => {
                  if (!confirm('Rotate the webhook secret? Update your verifier with the new one.')) return;
                  const result = await api.apps.regenerateWebhookSecret(app.id);
                  alert(`New webhook secret (saved once):\n\n${result.webhookSecret}\n\nStore it now.`);
                  appQ.refetch();
                }}
              >
                Rotate Webhook Secret
              </Button>
            </div>
          </div>
        </Card>

        <Card title="Input Requirements" subtitle="Metadata schema enforced on every payment" padding={0}>
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
              <KV k="Slug" v={<span className="mono">{app.slug}</span>} />
              <KV k="Created" v={formatRelative(app.createdAt)} />
            </div>
          </div>
        </Card>
      </div>

      <Card padding={0} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--hairline)' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Subscription Plans</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
              {plansQ.data ? `${plansQ.data.total} plan${plansQ.data.total === 1 ? '' : 's'} for ${app.name}` : 'Loading…'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button variant="primary" size="sm"
              leading={<Icon name="plus" size={11} strokeWidth={2.4} />}
              onClick={() => setAddPlanOpen(true)}>
              Add plan
            </Button>
            <button onClick={() => onNavigate('plans')} style={{
              background: 'none', border: 'none', fontSize: 12, color: 'var(--accent)', fontWeight: 550,
              display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
            }}>Manage all <Icon name="arrow" size={11} strokeWidth={2} /></button>
          </div>
        </div>
        {plansQ.loading && <LoadingBlock height={100} />}
        {plansQ.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{plansQ.error.message}</div>}
        {plansQ.data && plansQ.data.data.length === 0 && (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>
            No plans yet. <button onClick={() => onNavigate('plans')} style={{
              background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 'inherit', textDecoration: 'underline',
            }}>Register a plan</button> to start accepting subscriptions.
          </div>
        )}
        {plansQ.data && plansQ.data.data.length > 0 && (
          <Table
            dense
            columns={[
              { key: 'name', label: 'Plan', render: (r) => (
                <div>
                  <div style={{ fontWeight: 550 }}>{r.name}</div>
                  <div className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{r.slug}</div>
                </div>
              )},
              { key: 'description', label: 'Description', render: (r) => (
                <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>{r.description ?? '—'}</span>
              )},
              { key: 'amount', label: 'Price', align: 'right', render: (r) => (
                <span className="mono" style={{ fontWeight: 600 }}>
                  {formatAmountCompact(r.amount, r.currency)}
                  <span style={{ color: 'var(--muted)', fontWeight: 400 }}> /{r.interval[0]}</span>
                </span>
              )},
              { key: 'country', label: 'Country', render: (r) => (
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{r.country ?? 'worldwide'}</span>
              )},
              { key: 'provider', label: 'Provider', render: (r) => <ProviderTag name={r.provider} size="sm" /> },
              { key: 'providerPlanId', label: 'Plan ID', render: (r) => (
                <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{r.providerPlanId}</span>
              )},
              { key: 'isActive', label: 'Status', render: (r) => <StatusBadge status={r.isActive ? 'active' : 'inactive'} size="sm" /> },
              { key: 'actions', label: '', align: 'right', render: (r) => (
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  <Button variant="ghost" size="sm" onClick={() => setEditTarget(r)}>Edit</Button>
                  {r.provider === 'lemonsqueezy' && (
                    <Button variant="ghost" size="sm" onClick={() => setVerifyTarget(r)}>Verify</Button>
                  )}
                </span>
              )},
            ]}
            rows={plansQ.data.data}
            getRowKey={(r) => r.id}
          />
        )}
      </Card>

      <Card padding={0} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--hairline)' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Recent Transactions</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>Last 5 for {app.name}</div>
          </div>
          <button onClick={() => onNavigate('transactions', null, app.id)} style={{
            background: 'none', border: 'none', fontSize: 12, color: 'var(--accent)', fontWeight: 550,
            display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
          }}>View all <Icon name="arrow" size={11} strokeWidth={2} /></button>
        </div>
        {txQ.loading && <LoadingBlock height={120} />}
        {txQ.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{txQ.error.message}</div>}
        {txQ.data && (
          <Table
            dense
            columns={[
              { key: 'id', label: 'ID', render: (r) => <span className="mono" style={{ color: 'var(--accent)' }}>{r.id.slice(0, 8)}…</span> },
              { key: 'customer', label: 'Customer', render: (r) => r.customer?.email ?? '—' },
              { key: 'type', label: 'Type', render: (r) => <TypePill type={r.type === 'subscription_payment' ? 'subscription' : r.type} /> },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="mono" style={{ fontWeight: 600 }}>{formatAmountCompact(r.amount, r.currency)}</span> },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} size="sm" /> },
              { key: 'created', label: 'Created', align: 'right', render: (r) => <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{formatRelative(r.createdAt)}</span> },
            ]}
            rows={txQ.data.data}
            getRowKey={(r) => r.id}
            onRowClick={(r) => onNavigate('transaction-detail', r.id)}
          />
        )}
      </Card>

      <div ref={settingsAnchor} style={{ scrollMarginTop: 80 }}>
        <AppSettingsCard app={app} onSaved={() => appQ.refetch()} onDelete={() => setDeleteOpen(true)} />
      </div>

      {deactivateOpen && (
        <DeactivateAppModal
          appName={app.name}
          isActive={isActive}
          onClose={() => setDeactivateOpen(false)}
          onConfirm={async () => {
            if (isActive) await api.apps.deactivate(app.id);
            else await api.apps.activate(app.id);
            setDeactivateOpen(false);
            appQ.refetch();
          }}
        />
      )}

      {deleteOpen && (
        <DeleteAppModal
          appName={app.name}
          onClose={() => setDeleteOpen(false)}
          onConfirm={async () => {
            // Backend has no hard-delete endpoint yet; deactivate as the closest action.
            await api.apps.deactivate(app.id);
            setDeleteOpen(false);
            onBack();
          }}
        />
      )}

      {verifyTarget && (
        <Modal title={`Verify "${verifyTarget.name}"`} onClose={() => setVerifyTarget(null)} width={540}>
          <VerifyPlanContents
            plan={verifyTarget}
            onClose={() => setVerifyTarget(null)}
            onSynced={() => { plansQ.refetch(); setVerifyTarget(null); }}
          />
        </Modal>
      )}

      {editTarget && (
        <Modal title={`Edit "${editTarget.name}"`} onClose={() => setEditTarget(null)} width={560}>
          <EditPlanForm
            plan={editTarget}
            onClose={() => setEditTarget(null)}
            onSaved={() => { plansQ.refetch(); setEditTarget(null); }}
          />
        </Modal>
      )}

      {testOpen && (
        <Modal title={`Run test transaction · ${app.name}`} onClose={() => setTestOpen(false)} width={560}>
          <TestTransactionForm
            appId={app.id}
            plans={plansQ.data?.data.filter((p) => p.isActive) ?? []}
            onClose={() => setTestOpen(false)}
            onNavigate={onNavigate}
          />
        </Modal>
      )}

      {addPlanOpen && (
        <Modal title={`Add plan to ${app.name}`} onClose={() => setAddPlanOpen(false)} width={560}>
          <RegisterPlanForm
            // Lock the app dropdown to this app only — operator can't pick a different one
            // here. Use the standalone Plans page if they want cross-app management.
            apps={[{ id: app.id, name: app.name, billingMode: app.billingMode }]}
            onClose={() => setAddPlanOpen(false)}
            onCreated={() => { setAddPlanOpen(false); plansQ.refetch(); }}
            onNavigate={onNavigate}
          />
        </Modal>
      )}
    </PageShell>
  );
}

function VerifyPlanContents({ plan, onClose, onSynced }: {
  plan: Plan;
  onClose: () => void;
  onSynced: () => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [variant, setVariant] = React.useState<LookedUpVariant | null>(null);
  const [updatedPlan, setUpdatedPlan] = React.useState<Plan | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [changes, setChanges] = React.useState<Array<{ field: string; before: string; after: string }>>([]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setVariant(null); setUpdatedPlan(null); setChanges([]);
    api.plans.sync(plan.id)
      .then(({ plan: newPlan, variant: v }) => {
        if (cancelled) return;
        setVariant(v);
        setUpdatedPlan(newPlan);
        const diffs: Array<{ field: string; before: string; after: string }> = [];
        if (newPlan.amount !== plan.amount) {
          diffs.push({
            field: 'Price',
            before: `${(plan.amount / 100).toFixed(2)} ${plan.currency}`,
            after: `${(newPlan.amount / 100).toFixed(2)} ${newPlan.currency}`,
          });
        } else if (newPlan.currency !== plan.currency) {
          diffs.push({ field: 'Currency', before: plan.currency, after: newPlan.currency });
        }
        if (newPlan.interval !== plan.interval) {
          diffs.push({ field: 'Interval', before: plan.interval, after: newPlan.interval });
        }
        if (newPlan.intervalCount !== plan.intervalCount) {
          diffs.push({ field: 'Interval count', before: String(plan.intervalCount), after: String(newPlan.intervalCount) });
        }
        setChanges(diffs);
        setLoading(false);
      })
      .catch((err) => { if (!cancelled) { setError(err instanceof Error ? err.message : 'Sync failed'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [plan.id, plan.amount, plan.currency, plan.interval, plan.intervalCount]);

  if (loading) {
    return <div style={{ padding: '20px 0', color: 'var(--muted)', fontSize: 12.5 }}>Verifying with Lemon Squeezy…</div>;
  }
  if (error) {
    return (
      <div>
        <div style={{ padding: '10px 12px', background: 'var(--bad-soft)', color: 'var(--bad)', borderRadius: 6, fontSize: 12.5 }}>
          {error}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    );
  }
  if (!variant || !updatedPlan) return null;

  const wasInSync = changes.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        padding: '10px 12px',
        background: wasInSync ? 'var(--ok-soft)' : 'var(--info-soft)',
        border: `1px solid ${wasInSync ? 'var(--ok)' : 'var(--info)'}`,
        borderRadius: 6, fontSize: 12.5, lineHeight: 1.55,
      }}>
        {wasInSync
          ? <>✓ Already in sync. AcePay matches Lemon Squeezy — nothing to update.</>
          : <>✓ Synced. AcePay updated to match Lemon Squeezy ({changes.length} change{changes.length === 1 ? '' : 's'}).</>}
        {variant.testMode && <span style={{ display: 'inline-block', marginLeft: 8, color: 'var(--info)', fontWeight: 600 }}>TEST</span>}
      </div>

      {changes.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', background: 'var(--surface-2)', fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            What changed
          </div>
          {changes.map((c) => (
            <div key={c.field} style={{
              display: 'grid', gridTemplateColumns: '120px 1fr 14px 1fr',
              padding: '9px 12px', borderTop: '1px solid var(--hairline)',
              fontSize: 12, alignItems: 'center', gap: 10,
            }}>
              <div style={{ fontWeight: 600 }}>{c.field}</div>
              <span className="mono" style={{ color: 'var(--muted)', textDecoration: 'line-through' }}>{c.before}</span>
              <span style={{ color: 'var(--muted)' }}>→</span>
              <span className="mono" style={{ color: 'var(--ok)', fontWeight: 600 }}>{c.after}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', background: 'var(--surface-2)', fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Current state
        </div>
        <PlanFactRow label="Product"  value={variant.productName || '—'} />
        <PlanFactRow label="Variant"  value={variant.name} />
        <PlanFactRow label="Price"    value={`${(updatedPlan.amount / 100).toFixed(2)} ${updatedPlan.currency}`} highlight />
        <PlanFactRow label="Interval" value={`${updatedPlan.interval} (every ${updatedPlan.intervalCount})`} highlight />
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55 }}>
        AcePay&apos;s currency always follows Lemon Squeezy. Existing subscriptions keep billing at
        whatever price they were created with — only new subscriptions use these updated values.
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {changes.length > 0 && (
          <Button variant="primary" onClick={onSynced}>Done</Button>
        )}
      </div>
    </div>
  );
}

function PlanFactRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '120px 1fr',
      padding: '9px 12px', borderTop: '1px solid var(--hairline)',
      fontSize: 12, alignItems: 'center',
    }}>
      <div style={{ color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: 10.5, letterSpacing: 0.4 }}>
        {label}
      </div>
      <span className="mono" style={{ fontWeight: highlight ? 600 : 400 }}>{value}</span>
    </div>
  );
}

function TestTransactionForm({ appId, plans, onClose, onNavigate }: {
  appId: string;
  plans: Plan[];
  onClose: () => void;
  onNavigate: Navigate;
}) {
  const { user } = useAuth();
  const [planId, setPlanId] = React.useState(plans[0]?.id ?? '');
  const [email, setEmail] = React.useState(user?.email ?? '');
  const [name, setName] = React.useState(user?.name ?? '');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{
    subscriptionId: string; checkoutUrl: string; provider: string; customerId: string;
  } | null>(null);

  const selectedPlan = plans.find((p) => p.id === planId);

  const submit = async () => {
    setError(null);
    if (!planId) { setError('Pick a plan first.'); return; }
    if (!email.trim()) { setError('Customer email is required.'); return; }
    setSubmitting(true);
    try {
      const r = await api.apps.testSubscription(appId, {
        planId,
        customerEmail: email.trim(),
        customerName: name.trim() || undefined,
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start test transaction');
    } finally {
      setSubmitting(false);
    }
  };

  if (plans.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{
          padding: '14px 16px', background: 'var(--warn-soft)',
          border: '1px solid var(--warn)', borderRadius: 8,
          fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6,
        }}>
          <strong>No active plans.</strong> Add at least one plan to this app before running a test transaction.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{
          padding: '12px 14px', background: 'var(--ok-soft)',
          border: '1px solid var(--ok)', borderRadius: 8,
          fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
            ✓ Sandbox subscription created
          </div>
          AcePay opened a hosted checkout via <ProviderTag name={result.provider} size="sm" />. Complete payment using
          the provider&apos;s test card (LS test mode = card <span className="mono">4242 4242 4242 4242</span>;
          Xendit test mode = card <span className="mono">4000 0000 0000 0002</span>) to drive the full webhook
          + transaction flow.
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <PlanFactRow label="Subscription" value={result.subscriptionId} />
          <PlanFactRow label="Customer" value={result.customerId} />
          <PlanFactRow label="Provider" value={result.provider} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
          <Button variant="secondary" onClick={() => { onClose(); onNavigate('subscription-detail', result.subscriptionId); }}>
            View subscription
          </Button>
          <Button
            variant="primary"
            trailing={<Icon name="ext" size={11} strokeWidth={2.2} />}
            onClick={() => window.open(result.checkoutUrl, '_blank', 'noopener')}
          >
            Open checkout
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        padding: '10px 12px', background: 'var(--accent-soft)', borderRadius: 6,
        fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.55,
      }}>
        Creates a real subscription via the same code path apps use, tagged
        <span className="mono" style={{ margin: '0 4px' }}>metadata.sandbox=true</span>
        so you can filter test traffic out later. The provider treats this exactly like a customer-driven request — webhooks fire, the transaction shows in the dashboard.
      </div>

      <Field label="Plan" hint="Pick a plan registered for this app">
        <select value={planId} onChange={(e) => setPlanId(e.target.value)} style={{ ...inputStyle, paddingRight: 24 }}>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {(p.amount / 100).toFixed(2)} {p.currency}/{p.interval[0]} ({p.provider})
            </option>
          ))}
        </select>
      </Field>

      {selectedPlan && (
        <div style={{
          padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 6,
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--muted)',
        }}>
          <ProviderTag name={selectedPlan.provider} size="sm" />
          <span className="mono">{selectedPlan.providerPlanId}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Customer email" hint="Will be upserted as a sandbox customer">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="mono" style={inputStyle} />
        </Field>
        <Field label="Customer name" hint="Optional">
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
        </Field>
      </div>

      {error && <div style={{ color: 'var(--bad)', fontSize: 12 }}>{error}</div>}

      <div style={{
        display: 'flex', justifyContent: 'flex-end', gap: 8,
        paddingTop: 12, borderTop: '1px solid var(--hairline)',
      }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={submitting}>
          {submitting ? 'Creating…' : 'Create test subscription'}
        </Button>
      </div>
    </div>
  );
}

function AppSettingsCard({ app, onSaved, onDelete }: { app: AppView; onSaved: () => void; onDelete: () => void }) {
  const [name, setName] = React.useState(app.name);
  const [webhookUrl, setWebhookUrl] = React.useState(app.webhookUrl ?? '');
  const [rateLimit, setRateLimit] = React.useState(String(app.rateLimit));
  const [required, setRequired] = React.useState(app.requiredMetadata.join(', '));
  const [optional, setOptional] = React.useState(app.optionalMetadata.join(', '));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const dirty =
    name !== app.name ||
    webhookUrl !== (app.webhookUrl ?? '') ||
    Number(rateLimit) !== app.rateLimit ||
    required !== app.requiredMetadata.join(', ') ||
    optional !== app.optionalMetadata.join(', ');

  const onSave = async () => {
    setError(null);
    setSaving(true);
    try {
      await api.apps.update(app.id, {
        name,
        webhookUrl: webhookUrl.trim() || undefined,
        rateLimit: Number(rateLimit),
        requiredMetadata: required.split(',').map((s) => s.trim()).filter(Boolean),
        optionalMetadata: optional.split(',').map((s) => s.trim()).filter(Boolean),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Settings" subtitle="App-level configuration · changes take effect immediately" padding={0}>
      <div style={{ padding: '16px 18px 4px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Field label="App name" hint="Displayed across the dashboard">
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Slug" hint="Immutable">
          <input value={app.slug} disabled className="mono" style={{ ...inputStyle, background: 'var(--surface-2)', color: 'var(--muted)' }} />
        </Field>
        <Field label="Webhook URL" hint="POST destination for normalized events">
          <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} className="mono" style={inputStyle} />
        </Field>
        <Field label="Rate limit" hint="Requests / minute">
          <input value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} type="number" style={inputStyle} />
        </Field>
        <Field label="Required metadata" hint="comma-separated keys">
          <input value={required} onChange={(e) => setRequired(e.target.value)} className="mono" style={inputStyle} />
        </Field>
        <Field label="Optional metadata" hint="comma-separated keys">
          <input value={optional} onChange={(e) => setOptional(e.target.value)} className="mono" style={inputStyle} />
        </Field>
      </div>

      {error && (
        <div style={{ padding: '0 18px 12px', color: 'var(--bad)', fontSize: 12 }}>{error}</div>
      )}

      <div style={{
        padding: '14px 18px', borderTop: '1px solid var(--hairline)',
        background: 'var(--surface-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        borderBottomLeftRadius: 'var(--radius)', borderBottomRightRadius: 'var(--radius)',
      }}>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          {dirty ? 'Unsaved changes' : 'Up to date'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" size="md" onClick={() => {
            setName(app.name);
            setWebhookUrl(app.webhookUrl ?? '');
            setRateLimit(String(app.rateLimit));
            setRequired(app.requiredMetadata.join(', '));
            setOptional(app.optionalMetadata.join(', '));
          }}>Discard</Button>
          <Button variant="primary" size="md" onClick={onSave}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </div>

      <div style={{ padding: '14px 18px', borderTop: '1px solid var(--hairline)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--bad)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Danger Zone
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          border: '1px solid var(--bad-soft)', borderRadius: 6, padding: '10px 12px',
          background: '#FFFBFA',
        }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>Delete this app</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
              Hard-delete is not yet implemented; this currently deactivates the app and rejects new requests.
            </div>
          </div>
          <Button variant="danger" size="md" onClick={onDelete}>Delete app</Button>
        </div>
      </div>
    </Card>
  );
}

function DeactivateAppModal({ appName, isActive, onClose, onConfirm }: {
  appName: string; isActive: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const action = isActive ? 'Deactivate' : 'Activate';
  return (
    <Modal title={`${action} ${appName}?`} onClose={onClose}>
      <div style={{ padding: '4px 0 14px', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
        {isActive
          ? <>The API key will be rejected (403 app_inactive) until reactivated. In-flight payments + history are preserved.</>
          : <>The app will resume accepting payments using its existing key. No keys are rotated.</>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          variant="primary" onClick={onConfirm}
          style={isActive ? { background: 'var(--bad)', borderColor: 'var(--bad)' } : undefined}
        >{action} {appName}</Button>
      </div>
    </Modal>
  );
}

function DeleteAppModal({ appName, onClose, onConfirm }: {
  appName: string; onClose: () => void; onConfirm: () => void;
}) {
  const [confirmText, setConfirmText] = React.useState('');
  const canDelete = confirmText === appName;
  return (
    <Modal title={`Delete ${appName}?`} onClose={onClose}>
      <div style={{ padding: '4px 0 14px', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
        Type <span className="mono" style={{ color: 'var(--bad)', fontWeight: 600 }}>{appName}</span> to confirm.
        Hard-delete is not implemented yet — this will deactivate the app.
      </div>
      <input
        value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
        autoFocus className="mono" style={inputStyle} placeholder={appName}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={canDelete ? onConfirm : undefined}
          style={{
            background: canDelete ? 'var(--bad)' : 'var(--neutral-soft)',
            borderColor: canDelete ? 'var(--bad)' : 'var(--border)',
            color: canDelete ? '#fff' : 'var(--muted)',
            cursor: canDelete ? 'pointer' : 'not-allowed',
          }}
        >Delete {appName}</Button>
      </div>
    </Modal>
  );
}

function IntegrationBanner({ onNavigate }: { onNavigate: Navigate }) {
  return (
    <div
      onClick={() => onNavigate('integrate')}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 18px', marginBottom: 18,
        background: 'linear-gradient(180deg, var(--surface) 0%, var(--accent-soft) 200%)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--accent)',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        boxShadow: 'var(--shadow-1)',
        transition: 'transform 120ms, box-shadow 120ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = 'var(--shadow-2)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'var(--shadow-1)'; }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 8, flexShrink: 0,
        background: 'var(--accent)', color: 'var(--accent-ink)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="apps" size={18} color="var(--accent-ink)" strokeWidth={1.8} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
            Integrating an app for the first time?
          </div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 10.5, fontWeight: 600, color: 'var(--info)',
            background: 'var(--info-soft)', padding: '2px 7px', borderRadius: 999,
          }}>
            Web · Mobile · Test · Live
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 3, lineHeight: 1.5 }}>
          Step-by-step guide for charging customers via AcePay — auth, checkout, signed webhooks, refunds, and the test → live checklist.
        </div>
      </div>
      <Button
        variant="secondary"
        size="md"
        trailing={<Icon name="arrow" size={11} strokeWidth={2.4} />}
        onClick={() => onNavigate('integrate')}
      >
        Read the guide
      </Button>
    </div>
  );
}

function MetaTag({ label, optional }: { label: string; optional?: boolean }) {
  return (
    <span className="mono" style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 9px 3px 8px', borderRadius: 4,
      background: optional ? 'var(--surface-2)' : 'var(--accent-soft)',
      color: optional ? 'var(--ink-2)' : 'var(--accent)',
      fontSize: 11.5, fontWeight: 500,
      border: `1px solid ${optional ? 'var(--border)' : 'transparent'}`,
    }}>{label}</span>
  );
}

// Provider tag is unused here but kept for callers
export { ProviderTag };
