'use client';

import React from 'react';
import * as api from '../api/client';
import { formatAmountCompact, formatDateTime } from '../api/format';
import { LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { Plan } from '../api/types';
import { PageShell } from '../layout';
import {
  AppAvatar, Button, Card, FilterSelect, Icon, ProviderTag, StatusBadge, Table,
} from '../primitives';
import { Field, Modal, inputStyle } from '../shared';
import { Navigate } from '../types';

const PAGE_SIZE = 20;

export function PlansPage({ onNavigate }: { onNavigate: Navigate }) {
  const [appFilter, setAppFilter] = React.useState('All');
  const [providerFilter, setProviderFilter] = React.useState('All');
  const [intervalFilter, setIntervalFilter] = React.useState('All');
  const [activeFilter, setActiveFilter] = React.useState('All');
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<Plan | null>(null);

  const apps = useFetch(() => api.apps.list(), []);
  const query: api.PlanListQuery = {
    page, pageSize: PAGE_SIZE,
    appId: appFilter !== 'All' ? appFilter : undefined,
    provider: providerFilter !== 'All' ? providerFilter.toLowerCase() : undefined,
    interval: intervalFilter !== 'All' ? intervalFilter.toLowerCase() : undefined,
    isActive: activeFilter === 'All' ? undefined : activeFilter === 'Active',
  };
  const list = useFetch(() => api.plans.list(query), [JSON.stringify(query)]);

  const appOptions = ['All', ...(apps.data?.data ?? []).map((a) => ({ value: a.id, label: a.name }))];

  return (
    <PageShell
      title="Plans"
      breadcrumbs={[{ label: 'Operations' }, { label: 'Plans' }]}
      actions={
        <Button variant="primary" size="md" leading={<Icon name="plus" size={12} strokeWidth={2.4} />}
          onClick={() => setCreateOpen(true)}>
          Add Plan
        </Button>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <Icon name="filter" size={13} color="var(--muted)" />
        <FilterSelect label="App"      value={appFilter}      onChange={(v) => { setAppFilter(v); setPage(1); }}      options={appOptions} />
        <FilterSelect label="Provider" value={providerFilter} onChange={(v) => { setProviderFilter(v); setPage(1); }} options={['All', { value: 'lemonsqueezy', label: 'Lemon Squeezy' }, 'Xendit']} />
        <FilterSelect label="Interval" value={intervalFilter} onChange={(v) => { setIntervalFilter(v); setPage(1); }} options={['All', 'Weekly', 'Monthly', 'Yearly']} />
        <FilterSelect label="Status"   value={activeFilter}   onChange={(v) => { setActiveFilter(v); setPage(1); }}   options={['All', 'Active', 'Inactive']} />
        <div style={{ flex: 1 }} />
        {list.data && (
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{list.data.total} plans</span>
        )}
      </div>

      <Card padding={0}>
        {list.loading && <LoadingBlock height={200} />}
        {list.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{list.error.message}</div>}
        {list.data && (
          <>
            <Table<Plan>
              columns={[
                { key: 'name', label: 'Plan', render: (r) => (
                  <div>
                    <div style={{ fontWeight: 550 }}>{r.name}</div>
                    <div className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{r.slug}</div>
                  </div>
                )},
                { key: 'app', label: 'App', render: (r) => (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <AppAvatar name={r.app?.name ?? '?'} size={18} />{r.app?.name ?? '—'}
                  </span>
                )},
                { key: 'amount', label: 'Price', align: 'right', render: (r) => (
                  <span className="mono" style={{ fontWeight: 600 }}>
                    {formatAmountCompact(r.amount, r.currency)}
                    <span style={{ color: 'var(--muted)', fontWeight: 400 }}> /{r.interval[0]}</span>
                  </span>
                )},
                { key: 'provider', label: 'Provider', render: (r) => <ProviderTag name={r.provider} size="sm" /> },
                { key: 'providerPlanId', label: 'Provider ID', render: (r) => (
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{r.providerPlanId}</span>
                )},
                { key: 'isActive', label: 'Status', render: (r) => (
                  <StatusBadge status={r.isActive ? 'active' : 'inactive'} size="sm" />
                )},
                { key: 'created', label: 'Created', align: 'right', render: (r) => (
                  <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{formatDateTime(r.createdAt)}</span>
                )},
                { key: 'edit', label: '', align: 'right', render: (r) => (
                  <Button variant="ghost" size="sm" onClick={() => setEditTarget(r)}>Edit</Button>
                )},
              ]}
              rows={list.data.data}
              getRowKey={(r) => r.id}
            />
            <Pager total={list.data.total} page={list.data.page} pageSize={list.data.pageSize} onChange={setPage} />
          </>
        )}
      </Card>

      {createOpen && (
        <Modal title="Add a subscription plan" onClose={() => setCreateOpen(false)} width={600}>
          <RegisterPlanForm
            apps={(apps.data?.data ?? []).map((a) => ({ id: a.id, name: a.name, billingMode: a.billingMode }))}
            onClose={() => setCreateOpen(false)}
            onCreated={() => { setCreateOpen(false); list.refetch(); }}
            onNavigate={onNavigate}
          />
        </Modal>
      )}

      {editTarget && (
        <Modal title={`Edit "${editTarget.name}"`} onClose={() => setEditTarget(null)} width={560}>
          <EditPlanForm
            plan={editTarget}
            onClose={() => setEditTarget(null)}
            onSaved={() => { setEditTarget(null); list.refetch(); }}
          />
        </Modal>
      )}
    </PageShell>
  );
}

export function RegisterPlanForm({ apps, onClose, onCreated, onNavigate }: {
  apps: { id: string; name: string; billingMode?: string }[];
  onClose: () => void;
  onCreated: () => void;
  onNavigate: Navigate;
}) {
  // AcePay is subscription-only — every registered app can have plans.
  // Backend still enforces (apps.billing_mode='subscription') and will reject
  // legacy one-time apps with a clear error if needed.
  const eligibleApps = apps;

  const [appId, setAppId] = React.useState(eligibleApps[0]?.id ?? '');
  const [provider, setProvider] = React.useState<'lemonsqueezy' | 'xendit'>('lemonsqueezy');
  const [name, setName] = React.useState('');
  const [country, setCountry] = React.useState('');
  const [description, setDescription] = React.useState('');
  // Lemon Squeezy:
  const [variantId, setVariantId] = React.useState('');
  const [verifying, setVerifying] = React.useState(false);
  const [verified, setVerified] = React.useState<import('../api/types').LookedUpVariant | null>(null);
  const [verifyError, setVerifyError] = React.useState<string | null>(null);
  // Xendit (operator-entered, no provider lookup):
  const [amount, setAmount] = React.useState('');
  const [currency, setCurrency] = React.useState('PHP');
  const [interval, setInterval] = React.useState<'weekly' | 'monthly' | 'yearly'>('monthly');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const autoSlug = React.useMemo(
    () => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    [name],
  );

  const verify = async () => {
    if (!variantId.trim()) return;
    setVerifying(true);
    setVerifyError(null);
    setVerified(null);
    try {
      const v = await api.lemonsqueezy.lookupVariant(variantId.trim());
      if (!v.isSubscription) {
        setVerifyError(`"${v.name}" is not subscription-priced — pick a Subscription variant in LS.`);
      } else if (!v.interval) {
        setVerifyError('Unsupported interval (AcePay supports weekly, monthly, yearly).');
      } else {
        setVerified(v);
        if (!name) setName(`${v.productName || 'Plan'} — ${v.name}`);
      }
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Variant lookup failed');
    } finally {
      setVerifying(false);
    }
  };

  const submit = async () => {
    setError(null);
    if (!appId) { setError('Pick a subscription app first.'); return; }
    if (!name.trim()) { setError('Plan title is required.'); return; }
    if (provider === 'lemonsqueezy' && !verified) {
      setError('Verify the variant ID before registering.'); return;
    }
    if (provider === 'xendit' && (!amount || Number(amount) <= 0)) {
      setError('Amount is required for Xendit plans.'); return;
    }
    setSubmitting(true);
    try {
      const body = provider === 'lemonsqueezy'
        ? {
            appId,
            name: name.trim(),
            slug: autoSlug,
            amount: verified!.price,
            currency: verified!.currency || 'USD',
            interval: verified!.interval!,
            intervalCount: verified!.intervalCount,
            provider: 'lemonsqueezy',
            providerPlanId: variantId.trim(),
            description: description.trim() || undefined,
            country: country.trim() ? country.trim().toUpperCase() : undefined,
          }
        : {
            appId,
            name: name.trim(),
            slug: autoSlug,
            amount: Math.round(Number(amount) * 100),
            currency: currency.toUpperCase(),
            interval,
            intervalCount: 1,
            provider: 'xendit',
            // providerPlanId is synthesized server-side for Xendit
            description: description.trim() || undefined,
            country: country.trim() ? country.trim().toUpperCase() : undefined,
          };
      await api.plans.create(body);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register plan');
    } finally {
      setSubmitting(false);
    }
  };

  if (eligibleApps.length === 0) {
    return (
      <div style={{ minWidth: 480, padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '14px 16px',
          background: 'var(--accent-soft)', borderRadius: 8,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: 'var(--accent)', color: 'var(--accent-ink)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 700,
          }}>+</div>
          <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
              No apps registered yet
            </div>
            Plans belong to apps. Register an app first — you can add subscription plans inline
            during the same form, or come back here to add more later.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => { onClose(); onNavigate('register-app'); }}
            trailing={<Icon name="arrow" size={11} strokeWidth={2.4} />}
          >
            Register App
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="App" hint="Which app this plan belongs to">
          <select value={appId} onChange={(e) => setAppId(e.target.value)} style={{ ...inputStyle, paddingRight: 24 }}>
            {eligibleApps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Provider" hint="LS = international · Xendit = PH-local">
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as 'lemonsqueezy' | 'xendit');
              setVerified(null); setVerifyError(null);
            }}
            style={{ ...inputStyle, paddingRight: 24 }}
          >
            <option value="lemonsqueezy">Lemon Squeezy</option>
            <option value="xendit">Xendit</option>
          </select>
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
        <Field label="Title" hint="Operator-facing plan name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pro Monthly" style={inputStyle} />
        </Field>
        <Field label="Country" hint="ISO-2 · blank = global">
          <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="PH" className="mono" style={inputStyle} />
        </Field>
      </div>
      <Field label="Description" hint="Shown to operators next to the plan">
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Best for solo users" style={inputStyle} />
      </Field>

      {provider === 'lemonsqueezy' && (
        <>
          <Field label="Lemon Squeezy Variant ID" hint="Paste from your LS dashboard URL — click Verify to confirm & auto-fill price/interval">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={variantId}
                onChange={(e) => { setVariantId(e.target.value); setVerified(null); setVerifyError(null); }}
                placeholder="987654"
                className="mono"
                style={{ ...inputStyle, flex: 1 }}
              />
              <Button variant={verified ? 'secondary' : 'primary'} size="md" onClick={verify}>
                {verifying ? 'Verifying…' : verified ? '✓ Verified' : 'Verify'}
              </Button>
            </div>
          </Field>

          {verifyError && (
            <div style={{ background: 'var(--bad-soft)', color: 'var(--bad)', padding: '8px 10px', borderRadius: 6, fontSize: 11.5 }}>
              {verifyError}
            </div>
          )}

          {verified && (
            <div style={{
              padding: '10px 12px', background: 'var(--ok-soft)', border: '1px solid var(--ok)',
              borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {verified.productName ? `${verified.productName} — ` : ''}{verified.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {verified.testMode && <span style={{ marginRight: 8, color: 'var(--info)', fontWeight: 600 }}>TEST</span>}
                  Subscription · {verified.interval} (every {verified.intervalCount})
                </div>
              </div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
                {(verified.price / 100).toFixed(2)} {verified.currency || '—'}
              </div>
            </div>
          )}
        </>
      )}

      {provider === 'xendit' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <Field label="Amount" hint="Major units (e.g. 299.00)">
              <input
                value={amount} onChange={(e) => setAmount(e.target.value)}
                type="number" step="0.01"
                placeholder="299.00"
                className="mono"
                style={inputStyle}
              />
            </Field>
            <Field label="Currency">
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={4}
                className="mono"
                style={inputStyle}
              />
            </Field>
            <Field label="Interval">
              <select
                value={interval}
                onChange={(e) => setInterval(e.target.value as 'weekly' | 'monthly' | 'yearly')}
                style={{ ...inputStyle, paddingRight: 24 }}
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </Field>
          </div>
          <div style={{
            padding: '10px 12px',
            background: 'var(--xendit-bg)', border: '1px solid var(--xendit-ink)',
            borderRadius: 6, fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.55,
          }}>
            <strong>Xendit:</strong> AcePay manages the billing schedule. The customer&apos;s first
            payment is collected via a Xendit hosted Invoice (cards + GCash + Maya + GrabPay +
            bank transfer + OTC). The card saves automatically; renewals charge it on the cycle interval.
          </div>
        </>
      )}

      {error && <div style={{ color: 'var(--bad)', fontSize: 12 }}>{error}</div>}

      <div style={{
        display: 'flex', justifyContent: 'flex-end', gap: 8,
        marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--hairline)',
      }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{submitting ? 'Adding…' : 'Add Plan'}</Button>
      </div>
    </div>
  );
}

export function EditPlanForm({ plan, onClose, onSaved }: {
  plan: Plan;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isLs = plan.provider === 'lemonsqueezy';
  const [name, setName] = React.useState(plan.name);
  const [description, setDescription] = React.useState(plan.description ?? '');
  const [country, setCountry] = React.useState(plan.country ?? '');
  const [isActive, setIsActive] = React.useState(plan.isActive);
  // Xendit-only fields
  const [amount, setAmount] = React.useState((plan.amount / 100).toFixed(2));
  const [currency, setCurrency] = React.useState(plan.currency);
  const [interval, setInterval] = React.useState<'weekly' | 'monthly' | 'yearly'>(plan.interval);
  const [intervalCount, setIntervalCount] = React.useState(String(plan.intervalCount));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError('Plan title is required.'); return; }
    if (!isLs) {
      const n = Number(amount);
      if (!n || n <= 0) { setError('Amount must be greater than 0.'); return; }
    }
    setSaving(true);
    try {
      const body: Parameters<typeof api.plans.update>[1] = {
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        country: country.trim() ? country.trim().toUpperCase() : null,
        isActive,
      };
      if (!isLs) {
        body.amount = Math.round(Number(amount) * 100);
        body.currency = currency.toUpperCase();
        body.interval = interval;
        body.intervalCount = Number(intervalCount) || 1;
      }
      await api.plans.update(plan.id, body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update plan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 6,
        fontSize: 11.5, color: 'var(--muted)',
      }}>
        <ProviderTag name={plan.provider} size="sm" />
        <span className="mono">{plan.slug}</span>
        <span>·</span>
        <span className="mono">{plan.providerPlanId}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
        <Field label="Title" hint="Operator-facing plan name">
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Country" hint="ISO-2 · blank = global">
          <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} className="mono" style={inputStyle} />
        </Field>
      </div>

      <Field label="Description" hint="Shown to operators next to the plan">
        <input value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />
      </Field>

      {isLs ? (
        <div style={{
          padding: '10px 12px',
          background: 'var(--lemon-bg)', border: '1px solid var(--lemon-ink)',
          borderRadius: 6, fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.55,
        }}>
          <strong>Lemon Squeezy:</strong> price, currency, and interval come from the LS variant
          (<span className="mono">{plan.providerPlanId}</span>). Currently
          <span className="mono" style={{ marginLeft: 4, fontWeight: 600 }}>
            {(plan.amount / 100).toFixed(2)} {plan.currency} / {plan.interval}
          </span>. Edit the variant in LS, then use <strong>Verify</strong> to pull the new values.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 1fr 90px', gap: 10 }}>
          <Field label="Amount" hint="Major units">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" className="mono" style={inputStyle} />
          </Field>
          <Field label="Currency">
            <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={4} className="mono" style={inputStyle} />
          </Field>
          <Field label="Interval">
            <select value={interval} onChange={(e) => setInterval(e.target.value as 'weekly' | 'monthly' | 'yearly')} style={{ ...inputStyle, paddingRight: 24 }}>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </Field>
          <Field label="Every" hint="cycles">
            <input value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} type="number" min="1" className="mono" style={inputStyle} />
          </Field>
        </div>
      )}

      <label style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6,
        cursor: 'pointer', fontSize: 12.5,
      }}>
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        <span><strong>Active</strong> — apps can create new subscriptions on this plan.</span>
      </label>

      {!isActive && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55 }}>
          Existing subscriptions keep billing. Only new subscription creation will be rejected.
        </div>
      )}

      {error && <div style={{ color: 'var(--bad)', fontSize: 12 }}>{error}</div>}

      <div style={{
        display: 'flex', justifyContent: 'flex-end', gap: 8,
        marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--hairline)',
      }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{saving ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </div>
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
