'use client';

import React from 'react';
import * as api from '../api/client';
import { LookedUpVariant, Plan, PlanRegion } from '../api/types';
import { InlinePlanInput } from '../api/client';
import { Button, Card, Icon } from '../primitives';
import { PageShell } from '../layout';
import { CredentialReveal, Field, inputStyle } from '../shared';
import { Navigate } from '../types';

type DraftPlan = {
  key: string;
  provider: 'lemonsqueezy' | 'xendit';
  title: string;
  description: string;
  region: PlanRegion;
  // Lemon Squeezy:
  variantId: string;
  verifying: boolean;
  verified: LookedUpVariant | null;
  error: string | null;
  // Xendit (operator-entered, no provider lookup):
  amount: string;   // string for input control; parsed on submit
  currency: string;
  interval: 'weekly' | 'monthly' | 'yearly';
};

const newDraftPlan = (): DraftPlan => ({
  key: Math.random().toString(36).slice(2),
  provider: 'lemonsqueezy',
  title: '',
  description: '',
  region: 'international',
  variantId: '',
  verifying: false,
  verified: null,
  error: null,
  amount: '',
  currency: 'PHP',
  interval: 'monthly',
});

export function RegisterAppPage({ onNavigate, onBack }: { onNavigate: Navigate; onBack: () => void }) {
  const [step, setStep] = React.useState<'form' | 'created'>('form');

  const [name, setName] = React.useState('');
  const [webhookUrl, setWebhookUrl] = React.useState('');
  const [requiredMeta, setRequiredMeta] = React.useState('');
  const [optionalMeta, setOptionalMeta] = React.useState('');
  const [plans, setPlans] = React.useState<DraftPlan[]>([]);

  const [apiKey, setApiKey] = React.useState<string | null>(null);
  const [webhookSecret, setWebhookSecret] = React.useState<string | null>(null);
  const [createdPlans, setCreatedPlans] = React.useState<Plan[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const updatePlan = (key: string, patch: Partial<DraftPlan>) =>
    setPlans((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const verifyPlan = async (key: string) => {
    const target = plans.find((p) => p.key === key);
    if (!target || !target.variantId.trim()) return;
    updatePlan(key, { verifying: true, verified: null, error: null });
    try {
      const v = await api.lemonsqueezy.lookupVariant(target.variantId.trim());
      if (!v.isSubscription) {
        updatePlan(key, {
          verifying: false, verified: null,
          error: `That variant ("${v.name}") is not subscription-priced — pick a Subscription variant in LS.`,
        });
        return;
      }
      if (!v.interval) {
        updatePlan(key, {
          verifying: false, verified: null,
          error: 'That variant has an unsupported interval (AcePay supports weekly, monthly, yearly).',
        });
        return;
      }
      updatePlan(key, {
        verifying: false,
        verified: v,
        error: null,
        // Auto-fill title from the variant name if operator left it blank.
        title: target.title || `${v.productName || 'Plan'} — ${v.name}`,
      });
    } catch (err) {
      updatePlan(key, {
        verifying: false, verified: null,
        error: err instanceof Error ? err.message : 'Variant lookup failed',
      });
    }
  };

  const onRegister = async () => {
    if (!name.trim()) return;
    setError(null);

    for (const p of plans) {
      if (!p.title.trim()) {
        setError('Each plan needs a title.');
        return;
      }
      if (p.provider === 'lemonsqueezy' && !p.verified) {
        setError('Verify each Lemon Squeezy plan\'s variant ID before registering.');
        return;
      }
      if (p.provider === 'xendit' && (!p.amount || Number(p.amount) <= 0)) {
        setError('Each Xendit plan needs an amount (e.g. 299).');
        return;
      }
    }

    const planBody: InlinePlanInput[] = plans.map((p) => p.provider === 'lemonsqueezy'
      ? {
          provider: 'lemonsqueezy',
          variantId: p.variantId.trim(),
          title: p.title.trim() || (p.verified?.name ?? 'Plan'),
          description: p.description.trim() || undefined,
          region: p.region,
        }
      : {
          provider: 'xendit',
          title: p.title.trim(),
          description: p.description.trim() || undefined,
          region: p.region,
          amount: Math.round(Number(p.amount) * 100), // major → minor units
          currency: p.currency.toUpperCase(),
          interval: p.interval,
          intervalCount: 1,
        });

    setSubmitting(true);
    try {
      const result = await api.apps.register({
        name: name.trim(),
        webhookUrl: webhookUrl.trim() || undefined,
        requiredMetadata: requiredMeta.split(',').map((s) => s.trim()).filter(Boolean),
        optionalMetadata: optionalMeta.split(',').map((s) => s.trim()).filter(Boolean),
        billingMode: 'subscription',
        plans: planBody.length > 0 ? planBody : undefined,
      });
      setApiKey(result.apiKey);
      setWebhookSecret(result.webhookSecret);
      setCreatedPlans(result.plans ?? []);
      setStep('created');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register app');
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 'created') {
    return (
      <PageShell
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            <span>{name || 'New app'}</span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 8px', borderRadius: 999,
              background: 'var(--ok-soft)', color: 'var(--ok)',
              fontSize: 11.5, fontWeight: 600,
            }}>
              <Icon name="check" size={11} strokeWidth={2.5} /> Registered
            </span>
          </span>
        }
        breadcrumbs={[
          { label: 'Apps', onClick: onBack },
          { label: 'Register' },
          { label: name || 'New app' },
        ]}
      >
        <div style={{ maxWidth: 720 }}>
          <div style={{
            background: 'var(--ok-soft)', border: '1px solid var(--ok)',
            borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 18,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <Icon name="check" size={16} color="var(--ok)" strokeWidth={2.4} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ok)' }}>App registered successfully</div>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 3, lineHeight: 1.55 }}>
                Save these credentials now. The API key and webhook secret will not be shown again — AcePay does not persist them in plaintext.
              </div>
            </div>
          </div>

          <Card title="Credentials" subtitle="Store these in your app's secret manager" padding={0}>
            <div style={{ padding: '4px 16px 14px' }}>
              <CredentialReveal label="API Key" value={apiKey ?? ''} />
              <CredentialReveal label="Webhook Secret" value={webhookSecret ?? ''} />
            </div>
          </Card>

          {createdPlans.length > 0 && (
            <Card title={`${createdPlans.length} plan${createdPlans.length === 1 ? '' : 's'} created`} padding={0} style={{ marginTop: 16 }}>
              <div style={{ padding: '4px 16px 14px' }}>
                {createdPlans.map((p) => (
                  <div key={p.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                        <span className="mono">{p.slug}</span> · variant {p.providerPlanId} · {p.region === 'local' ? 'Local (PH)' : 'International'}
                      </div>
                    </div>
                    <div className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
                      {(p.amount / 100).toFixed(2)} {p.currency} / {p.interval[0]}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <Button variant="secondary" onClick={onBack}>Back to Apps</Button>
            <Button variant="primary" onClick={() => onNavigate('apps')}>I&apos;ve saved the credentials</Button>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Register a new app"
      breadcrumbs={[
        { label: 'Apps', onClick: onBack },
        { label: 'Register' },
      ]}
    >
      <div style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Step 1 — App basics */}
        <Card title="App details" subtitle="Shown across the dashboard and in webhook payloads" padding={0}>
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="App name" hint="Required · displayed in the dashboard, receipts, and webhook payloads">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My new app" style={inputStyle} autoFocus />
            </Field>
            <Field label="Slug" hint="URL-safe identifier · auto-generated from app name">
              <input value={slug} readOnly placeholder="my-new-app" className="mono" style={{ ...inputStyle, background: 'var(--surface-2)', color: 'var(--muted)' }} />
            </Field>
            <Field label="Webhook URL" hint="AcePay POSTs events to this endpoint">
              <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://your-app.com/webhooks/acepay" className="mono" style={inputStyle} />
            </Field>
          </div>
        </Card>

        {/* Step 2 — Metadata */}
        <Card title="Metadata schema" subtitle="Comma-separated keys the app sends with each subscription" padding={0}>
          <div style={{ padding: '16px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Required metadata" hint="Subscriptions missing these keys will be rejected">
              <input value={requiredMeta} onChange={(e) => setRequiredMeta(e.target.value)} placeholder="user_id, plan" className="mono" style={inputStyle} />
            </Field>
            <Field label="Optional metadata" hint="Stored if present, ignored if absent">
              <input value={optionalMeta} onChange={(e) => setOptionalMeta(e.target.value)} placeholder="promo_code, referrer" className="mono" style={inputStyle} />
            </Field>
          </div>
        </Card>

        {/* Step 3 — Subscription plans */}
        <Card
          title="Subscription plans (optional)"
          subtitle="Add plans now, or skip and add them later from the Plans page"
          padding={0}
          action={
            <Button variant="secondary" size="sm" leading={<Icon name="plus" size={11} strokeWidth={2.4} />}
              onClick={() => setPlans((p) => [...p, newDraftPlan()])}>
              Add plan
            </Button>
          }
        >
          <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {plans.length === 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                No plans yet — that's fine. You can register the app now and add plans later.
              </div>
            )}
            {plans.length > 0 && <HelpBlock />}
            {plans.map((p, i) => (
              <PlanRow
                key={p.key}
                index={i + 1}
                plan={p}
                onChange={(patch) => updatePlan(p.key, patch)}
                onVerify={() => verifyPlan(p.key)}
                onRemove={() => setPlans((prev) => prev.filter((x) => x.key !== p.key))}
                canRemove
              />
            ))}
          </div>
        </Card>

        {error && (
          <div style={{ background: 'var(--bad-soft)', color: 'var(--bad)', padding: '10px 14px', borderRadius: 6, fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <Button variant="secondary" onClick={onBack}>Cancel</Button>
          <Button variant="primary" onClick={onRegister}
            trailing={<Icon name="arrow" size={11} strokeWidth={2.4} />}>
            {submitting ? 'Registering…' : 'Register & generate keys'}
          </Button>
        </div>
      </div>
    </PageShell>
  );
}

function HelpBlock() {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '10px 14px', background: 'none', border: 'none',
          fontSize: 12, color: 'var(--ink-2)', fontWeight: 600, cursor: 'pointer',
        }}
      >
        <Icon name={open ? 'chevronDown' : 'chevron'} size={12} />
        How do I get a Lemon Squeezy variant ID?
      </button>
      {open && (
        <div style={{ padding: '0 14px 12px', fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>Go to your <strong>Lemon Squeezy dashboard → Products → New product</strong>.</li>
            <li>Pricing: pick <strong>Subscription</strong>, set the recurring price + interval (monthly / yearly).</li>
            <li>Save the product, then click into it → click the variant row.</li>
            <li>Copy the variant ID from the URL (the number after <span className="mono">/variants/</span>) and paste it below.</li>
            <li>Click <strong>Verify</strong> — AcePay fetches the variant from Lemon Squeezy and confirms the price/interval.</li>
          </ol>
        </div>
      )}
    </div>
  );
}

function PlanRow({ index, plan, onChange, onVerify, onRemove, canRemove }: {
  index: number;
  plan: DraftPlan;
  onChange: (patch: Partial<DraftPlan>) => void;
  onVerify: () => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px',
      background: plan.verified ? 'var(--ok-soft)' : 'var(--surface)',
      borderColor: plan.verified ? 'var(--ok)' : plan.error ? 'var(--bad)' : 'var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Plan {index}
        </div>
        {canRemove && (
          <button onClick={onRemove} style={{ background: 'none', border: 'none', padding: 4, color: 'var(--muted)', cursor: 'pointer' }}>
            <Icon name="x" size={13} />
          </button>
        )}
      </div>

      <Field label="Provider" hint="Lemon Squeezy = international cards & MoR for tax. Xendit = PH-local (cards + e-wallets soon).">
        <select
          value={plan.provider}
          onChange={(e) => onChange({
            provider: e.target.value as 'lemonsqueezy' | 'xendit',
            verified: null, error: null,
          })}
          style={{ ...inputStyle, paddingRight: 24 }}
        >
          <option value="lemonsqueezy">Lemon Squeezy</option>
          <option value="xendit">Xendit</option>
        </select>
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
        <Field label="Title" hint="Operator-facing plan name">
          <input
            value={plan.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Pro Monthly"
            style={inputStyle}
          />
        </Field>
        <Field label="Region" hint="Local = Philippines · International = anywhere else">
          <select
            value={plan.region}
            onChange={(e) => onChange({ region: e.target.value as PlanRegion })}
            style={{ ...inputStyle, paddingRight: 24 }}
          >
            <option value="international">International</option>
            <option value="local">Local (PH)</option>
          </select>
        </Field>
      </div>

      <div style={{ marginTop: 10 }}>
        <Field label="Description" hint="Shown to operators next to the plan">
          <input
            value={plan.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Best for solo users"
            style={inputStyle}
          />
        </Field>
      </div>

      {plan.provider === 'lemonsqueezy' && (
        <>
          <div style={{ marginTop: 10 }}>
            <Field label="Lemon Squeezy Variant ID" hint="Paste from your LS dashboard URL — click Verify to confirm & auto-fill price/interval">
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={plan.variantId}
                  onChange={(e) => onChange({ variantId: e.target.value, verified: null, error: null })}
                  placeholder="987654"
                  className="mono"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <Button variant={plan.verified ? 'secondary' : 'primary'} size="md" onClick={onVerify}>
                  {plan.verifying ? 'Verifying…' : plan.verified ? '✓ Verified' : 'Verify'}
                </Button>
              </div>
            </Field>
          </div>

          {plan.error && (
            <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bad-soft)', color: 'var(--bad)', borderRadius: 6, fontSize: 11.5 }}>
              {plan.error}
            </div>
          )}

          {plan.verified && (
            <div style={{
              marginTop: 10, padding: '10px 12px', background: 'var(--surface)',
              border: '1px solid var(--ok)', borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {plan.verified.productName ? `${plan.verified.productName} — ` : ''}{plan.verified.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {plan.verified.testMode && (
                    <span style={{ marginRight: 8, color: 'var(--info)', fontWeight: 600 }}>TEST</span>
                  )}
                  Subscription · {plan.verified.interval} (every {plan.verified.intervalCount})
                </div>
              </div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
                {(plan.verified.price / 100).toFixed(2)} {plan.verified.currency || '—'}
              </div>
            </div>
          )}
        </>
      )}

      {plan.provider === 'xendit' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 10 }}>
            <Field label="Amount" hint="Major units (e.g. 299.00)">
              <input
                value={plan.amount}
                onChange={(e) => onChange({ amount: e.target.value })}
                type="number" step="0.01"
                placeholder="299.00"
                className="mono"
                style={inputStyle}
              />
            </Field>
            <Field label="Currency">
              <input
                value={plan.currency}
                onChange={(e) => onChange({ currency: e.target.value.toUpperCase() })}
                maxLength={4}
                className="mono"
                style={inputStyle}
              />
            </Field>
            <Field label="Interval">
              <select
                value={plan.interval}
                onChange={(e) => onChange({ interval: e.target.value as 'weekly' | 'monthly' | 'yearly' })}
                style={{ ...inputStyle, paddingRight: 24 }}
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </Field>
          </div>
          <div style={{
            marginTop: 8, padding: '10px 12px',
            background: 'var(--xendit-bg)', border: '1px solid var(--xendit-ink)',
            borderRadius: 6, fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.55,
          }}>
            <strong>Xendit:</strong> AcePay manages the billing schedule. First payment is collected
            via Xendit Invoice (cards + GCash + Maya + GrabPay + bank transfer + OTC) — the card token
            saves automatically. Renewals charge the saved card on the cycle interval. E-wallet
            recurring arrives in Slice 4c.
          </div>
        </>
      )}
    </div>
  );
}

