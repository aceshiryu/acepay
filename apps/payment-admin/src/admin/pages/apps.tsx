'use client';

import React from 'react';
import * as api from '../api/client';
import { formatRelative } from '../api/format';
import { LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { AppView } from '../api/types';
import { PageShell } from '../layout';
import { Button, Card, Icon, ProviderTag, StatusBadge, Table, AppAvatar } from '../primitives';
import { Field, MiniStatCard, Modal, inputStyle } from '../shared';
import { LookedUpVariant, Plan } from '../api/types';
import { useAuth } from '../auth/auth-context';
import { Navigate } from '../types';
import { AddAppTile, AppCard } from '../app-card';
import { notifyAppsChanged } from '../events';

export function AppsPage({ onNavigate }: { onNavigate: Navigate }) {
  const apps = useFetch(() => api.apps.list(), []);
  const archived = useFetch(() => api.apps.list({ archived: true }), []);
  const appList = apps.data?.data ?? [];
  const archivedList = archived.data?.data ?? [];
  const [tab, setTab] = React.useState<'apps' | 'archived'>('apps');
  const reloadAll = () => { apps.refetch(); archived.refetch(); notifyAppsChanged(); };
  const [view, setView] = React.useState<'grid' | 'list'>('grid');
  React.useEffect(() => {
    try { if (localStorage.getItem('acepay.apps.view') === 'list') setView('list'); } catch { /* storage blocked */ }
  }, []);
  const changeView = (v: 'grid' | 'list') => {
    setView(v);
    try { localStorage.setItem('acepay.apps.view', v); } catch { /* storage blocked */ }
  };

  return (
    <PageShell
      title="Apps"
      subtitle="Every app that charges customers through AcePay. Click one to see its plans, keys and payments."
      actions={
        <Button variant="primary" size="md" leading={<Icon name="plus" size={12} strokeWidth={2.4} />} onClick={() => onNavigate('register-app')}>
          Register App
        </Button>
      }
    >
      <IntegrationBanner onNavigate={onNavigate} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 22 }}>
        <MiniStatCard label="Total Apps" value={appList.length} sub={`${appList.filter((a) => a.isActive).length} active`} />
        <MiniStatCard label="Active" value={appList.filter((a) => a.isActive).length} sub="accepting payments" />
        <MiniStatCard label="Inactive" value={appList.filter((a) => !a.isActive).length} sub="paused" />
        <MiniStatCard label="With webhook URL" value={appList.filter((a) => a.webhookUrl).length} sub="receiving deliveries" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '6px 0 14px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <TabButton active={tab === 'apps'} onClick={() => setTab('apps')}>My apps</TabButton>
          <TabButton active={tab === 'archived'} onClick={() => setTab('archived')}>
            Archived{archivedList.length ? ` (${archivedList.length})` : ''}
          </TabButton>
        </div>
        {tab === 'apps' && <ViewToggle value={view} onChange={changeView} />}
      </div>

      {tab === 'archived' && (
        <ArchivedApps
          loading={archived.loading}
          error={archived.error?.message ?? null}
          rows={archivedList}
          onChanged={reloadAll}
          onOpen={(id) => onNavigate('app-detail', id)}
        />
      )}

      {tab === 'apps' && view === 'grid' && (
        <>
          {apps.loading && <LoadingBlock height={200} />}
          {apps.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{apps.error.message}</div>}
          {apps.data && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 18 }}>
              {appList.map((a) => <AppCard key={a.id} app={a} onNavigate={onNavigate} />)}
              <AddAppTile onClick={() => onNavigate('register-app')} />
            </div>
          )}
        </>
      )}

      {tab === 'apps' && view === 'list' && (
      <Card padding={0}>
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
      )}
    </PageShell>
  );
}

export function VerifyPlanContents({ plan, onClose, onSynced }: {
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

export function TestTransactionForm({ appId, plans, onClose, onNavigate }: {
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
    subscriptionId: string; subscriptionCode: string; checkoutUrl: string; provider: string; customerId: string; customerCode: string;
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
          <PlanFactRow label="Subscription" value={result.subscriptionCode} />
          <PlanFactRow label="Customer" value={result.customerCode} />
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

export function AppSettingsCard({ app, onSaved, onArchive, onRestore, onDeletePermanently }: {
  app: AppView;
  onSaved: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDeletePermanently: () => void;
}) {
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
        {app.archivedAt ? (
          <>
            <DangerRow
              title="Restore this app"
              body="Brings it back into the sidebar and lists. It stays deactivated until you activate it."
              action={<Button variant="secondary" size="md" onClick={onRestore}>Restore</Button>}
            />
            <DangerRow
              title="Delete permanently"
              body="Removes the app and all of its plans, customers, subscriptions, transactions, logs and webhook events. This cannot be undone."
              action={<Button variant="danger" size="md" onClick={onDeletePermanently}>Delete permanently</Button>}
            />
          </>
        ) : (
          <DangerRow
            title="Archive this app"
            body="Hides it from the sidebar and every list, and its API key stops working. All history is kept, and you can restore it or delete it permanently later."
            action={<Button variant="danger" size="md" onClick={onArchive}>Archive app</Button>}
          />
        )}
      </div>
    </Card>
  );
}

export function DeactivateAppModal({ appName, isActive, onClose, onConfirm }: {
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

function DangerRow({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      border: '1px solid var(--bad-soft)', borderRadius: 6, padding: '10px 12px',
      background: 'var(--surface)', marginTop: 8,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>{body}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{action}</div>
    </div>
  );
}

export function ArchiveAppModal({ appName, onClose, onConfirm }: {
  appName: string; onClose: () => void; onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Modal title={`Archive ${appName}?`} onClose={onClose}>
      <div style={{ padding: '4px 0 14px', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
        {appName} disappears from the sidebar, the Apps page and every app filter, and its API key is
        rejected (403 app_inactive). Its payments, subscriptions and logs are kept. You can restore it, or
        delete it permanently, from <strong>Apps → Archived</strong>.
      </div>
      {error && <div style={{ color: 'var(--bad)', fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          variant="primary" disabled={busy}
          style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }}
          onClick={async () => {
            setBusy(true); setError(null);
            try { await onConfirm(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not archive'); setBusy(false); }
          }}
        >{busy ? 'Archiving…' : `Archive ${appName}`}</Button>
      </div>
    </Modal>
  );
}

/** Type-the-name confirmation. The server re-checks the name and refuses while
 *  the app has live subscriptions or payouts in flight; its message is shown. */
export function DeleteAppPermanentlyModal({ appName, onClose, onConfirm }: {
  appName: string; onClose: () => void; onConfirm: (confirmName: string) => Promise<void>;
}) {
  const [confirmText, setConfirmText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const canDelete = confirmText === appName && !busy;
  return (
    <Modal title={`Permanently delete ${appName}?`} onClose={onClose}>
      <div style={{ padding: '4px 0 14px', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
        This removes {appName} and <strong>all</strong> of its plans, customers, subscriptions, transactions,
        payouts, logs and webhook events. <strong>It cannot be undone.</strong> Nothing is changed at the
        payment provider. Type <span className="mono" style={{ color: 'var(--bad)', fontWeight: 600 }}>{appName}</span> to confirm.
      </div>
      <input
        value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
        autoFocus className="mono" style={inputStyle} placeholder={appName}
      />
      {error && <div style={{ color: 'var(--bad)', fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!canDelete}
          onClick={async () => {
            setBusy(true); setError(null);
            try { await onConfirm(confirmText); } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete'); setBusy(false); }
          }}
          style={{
            background: canDelete ? 'var(--bad)' : 'var(--neutral-soft)',
            borderColor: canDelete ? 'var(--bad)' : 'var(--border)',
            color: canDelete ? '#fff' : 'var(--muted)',
            cursor: canDelete ? 'pointer' : 'not-allowed',
          }}
        >{busy ? 'Deleting…' : 'Delete permanently'}</Button>
      </div>
    </Modal>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        background: 'none', border: 'none', padding: '0 0 4px', cursor: 'pointer',
        fontSize: active ? 22 : 15, fontWeight: 700, letterSpacing: active ? -0.4 : 0,
        color: active ? 'var(--ink)' : 'var(--muted)',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
      }}
    >{children}</button>
  );
}

/** Archived apps: hidden everywhere else. Restore brings one back (deactivated);
 *  Delete permanently removes it and all its data. */
function ArchivedApps({ loading, error, rows, onChanged, onOpen }: {
  loading: boolean; error: string | null; rows: AppView[]; onChanged: () => void; onOpen: (id: string) => void;
}) {
  const [deleting, setDeleting] = React.useState<AppView | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);
  return (
    <Card padding={0}>
      {loading && <LoadingBlock height={120} />}
      {error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>
          No archived apps. Archive one from its App settings → Danger Zone.
        </div>
      )}
      {rowError && <div style={{ padding: '10px 16px', color: 'var(--bad)', fontSize: 12 }}>{rowError}</div>}
      {rows.length > 0 && (
        <Table<AppView>
          columns={[
            { key: 'name', label: 'App', render: (a) => (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                <AppAvatar name={a.name} size={22} />
                <span>
                  <div style={{ fontWeight: 550, color: 'var(--ink)' }}>{a.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{a.code}</div>
                </span>
              </span>
            ) },
            { key: 'providers', label: 'Provider', render: (a) => a.providers[0] ? <ProviderTag name={a.providers[0]} size="sm" /> : <span style={{ color: 'var(--muted)' }}>—</span> },
            { key: 'archivedAt', label: 'Archived', render: (a) => (
              <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{a.archivedAt ? formatRelative(a.archivedAt) : '—'}</span>
            ) },
            { key: 'actions', label: '', align: 'right', render: (a) => (
              <span style={{ display: 'inline-flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                <Button variant="secondary" size="sm" onClick={async () => {
                  setRowError(null);
                  try { await api.apps.restore(a.id); onChanged(); }
                  catch (err) { setRowError(err instanceof Error ? err.message : 'Could not restore'); }
                }}>Restore</Button>
                <Button variant="danger" size="sm" onClick={() => setDeleting(a)}>Delete permanently</Button>
              </span>
            ) },
          ]}
          rows={rows}
          getRowKey={(r) => r.id}
          onRowClick={(a) => onOpen(a.id)}
        />
      )}
      {deleting && (
        <DeleteAppPermanentlyModal
          appName={deleting.name}
          onClose={() => setDeleting(null)}
          onConfirm={async (confirmName) => {
            await api.apps.deletePermanently(deleting.id, confirmName);
            setDeleting(null);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function ViewToggle({ value, onChange }: { value: 'grid' | 'list'; onChange: (v: 'grid' | 'list') => void }) {
  return (
    <div style={{ display: 'inline-flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 3 }}>
      {(['grid', 'list'] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-label={v === 'grid' ? 'Card view' : 'Table view'}
          aria-pressed={value === v}
          style={{
            width: 32, height: 28, borderRadius: 7, border: 'none',
            background: value === v ? 'var(--accent-soft)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}
        >
          <Icon name={v} size={15} color={value === v ? 'var(--accent)' : 'var(--muted)'} />
        </button>
      ))}
    </div>
  );
}

function IntegrationBanner({ onNavigate }: { onNavigate: Navigate }) {
  return (
    <div
      onClick={() => onNavigate('integrate')}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 18px', marginBottom: 18,
        background: 'linear-gradient(100deg, var(--accent-soft) 0%, var(--surface) 70%)',
        border: '1px solid var(--hairline)',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        boxShadow: 'var(--shadow-1)',
        transition: 'transform 120ms, box-shadow 120ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = 'var(--shadow-2)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'var(--shadow-1)'; }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 12, flexShrink: 0,
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

export function MetaTag({ label, optional }: { label: string; optional?: boolean }) {
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
