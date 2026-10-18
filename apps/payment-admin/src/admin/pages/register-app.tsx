'use client';

import React from 'react';
import * as api from '../api/client';
import { LookedUpVariant, Plan, PlanRegion, Provider } from '../api/types';
import { InlinePlanInput } from '../api/client';
import { useFetch } from '../api/use-fetch';
import { notifyAppsChanged } from '../events';
import { Button, Icon } from '../primitives';
import { PROVIDER_THEME, PROVIDERS, providerTheme } from '../provider-theme';
import { CredentialReveal, Field, inputStyle } from '../shared';
import { Navigate } from '../types';
import { codesFor, groupsOf, METHOD_GROUPS } from './app-payment-methods';
import { parseDraft, RowDraft } from './marketplace';

type DraftPlan = {
  key: string;
  provider: Provider;
  title: string;
  description: string;
  region: PlanRegion;
  // Lemon Squeezy:
  variantId: string;
  verifying: boolean;
  verified: LookedUpVariant | null;
  error: string | null;
  // PayMongo: optional existing plan to link instead of creating one.
  paymongoPlanId: string;
  // Xendit + PayMongo (operator-entered):
  amount: string;   // string for input control; parsed on submit
  currency: string;
  interval: 'weekly' | 'monthly' | 'yearly';
};

const newDraftPlan = (provider: Provider): DraftPlan => ({
  key: Math.random().toString(36).slice(2),
  provider,
  title: '',
  description: '',
  region: provider === 'lemonsqueezy' ? 'international' : 'local',
  variantId: '',
  verifying: false,
  verified: null,
  error: null,
  paymongoPlanId: '',
  amount: '',
  currency: 'PHP',
  interval: 'monthly',
});

const PROVIDER_NOTES: Record<Provider, string[]> = {
  lemonsqueezy: [
    'Every plan must be a Subscription-priced variant in your Lemon Squeezy store. Verify fills in the price and interval.',
    'Lemon Squeezy is the merchant of record: it collects tax and shows its own checkout.',
  ],
  xendit: [
    'AcePay runs the billing schedule. The first payment goes through a Xendit invoice and the card is saved for renewals.',
    'A failed renewal marks the subscription past due and tells your app by webhook.',
  ],
  paymongo: [
    'One-time payments: your app calls POST /v1/payments and sends the customer to PayMongo Checkout (card, GCash, Maya, …). PHP only.',
    'Subscriptions need PayMongo to enable them on your account first. PayMongo bills every cycle itself; pause and resume are not supported.',
  ],
};

/**
 * Add app: pick a provider, then fill a form whose fields (and colours) belong
 * to that provider. Every plan uses the chosen provider — that is what ties the
 * app to it, since apps have no provider column of their own.
 */
export function AddAppModal({ onClose, onNavigate, initialProvider }: {
  onClose: () => void;
  onNavigate: Navigate;
  initialProvider?: Provider | null;
}) {
  const integrations = useFetch(() => api.integrations.list(), []);
  const rows = integrations.data?.integrations ?? [];
  const configured = (p: Provider) => rows.find((r) => r.provider === p)?.configured ?? false;
  const modeOf = (p: Provider) => rows.find((r) => r.provider === p)?.mode ?? 'unknown';

  const [provider, setProvider] = React.useState<Provider | null>(initialProvider ?? null);
  const [step, setStep] = React.useState<'provider' | 'form' | 'created'>(initialProvider ? 'form' : 'provider');

  const [name, setName] = React.useState('');
  const [webhookUrl, setWebhookUrl] = React.useState('');
  const [requiredMeta, setRequiredMeta] = React.useState('');
  const [optionalMeta, setOptionalMeta] = React.useState('');
  // Only Lemon Squeezy needs plans; Xendit and PayMongo apps can take
  // payments without them, so they start with none.
  const plansRequired = (p: Provider | null | undefined) => p === 'lemonsqueezy';
  const startingPlans = (p: Provider | null | undefined): DraftPlan[] => (plansRequired(p) ? [newDraftPlan(p as Provider)] : []);
  const [plans, setPlans] = React.useState<DraftPlan[]>(() => startingPlans(initialProvider));
  const [methods, setMethods] = React.useState<Set<string>>(() => groupsOf(null));
  const [market, setMarket] = React.useState<RowDraft>({ enabled: false, feePercent: '', minPayout: '500', feeMin: '', feeMax: '' });

  const [created, setCreated] = React.useState<{ appId: string; apiKey: string; webhookSecret: string; plans: Plan[]; warning: string | null } | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const theme = providerTheme(provider);

  const pick = (p: Provider) => {
    if (p === provider) { setStep('form'); return; }
    const filled = plans.some((x) => x.title.trim() || x.variantId.trim() || x.amount.trim() || x.paymongoPlanId.trim());
    if (filled && !confirm(`Switch to ${PROVIDER_THEME[p].label}? The plans you filled in are for ${theme?.label} and will be cleared.`)) return;
    setProvider(p);
    setPlans(startingPlans(p));
    setError(null);
    setStep('form');
  };

  const updatePlan = (key: string, patch: Partial<DraftPlan>) =>
    setPlans((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const verifyPlan = async (key: string) => {
    const target = plans.find((p) => p.key === key);
    if (!target || !target.variantId.trim()) return;
    updatePlan(key, { verifying: true, verified: null, error: null });
    try {
      const v = await api.lemonsqueezy.lookupVariant(target.variantId.trim());
      if (!v.isSubscription) {
        updatePlan(key, { verifying: false, error: `That variant ("${v.name}") is not subscription-priced — pick a Subscription variant in LS.` });
        return;
      }
      if (!v.interval) {
        updatePlan(key, { verifying: false, error: 'That variant has an unsupported interval (AcePay supports weekly, monthly, yearly).' });
        return;
      }
      updatePlan(key, { verifying: false, verified: v, error: null, title: target.title || `${v.productName || 'Plan'} — ${v.name}` });
    } catch (err) {
      updatePlan(key, { verifying: false, error: err instanceof Error ? err.message : 'Variant lookup failed' });
    }
  };

  const register = async () => {
    if (!provider) return;
    setError(null);
    if (!name.trim()) { setError('Give the app a name.'); return; }
    if (plans.length === 0 && plansRequired(provider)) { setError('Add at least one plan — Lemon Squeezy only takes payments through subscription plans.'); return; }
    for (const p of plans) {
      if (!p.title.trim() && !(p.provider === 'lemonsqueezy' && p.verified)) { setError('Each plan needs a title.'); return; }
      if (p.provider === 'lemonsqueezy' && !p.verified) { setError('Verify each plan’s variant ID first.'); return; }
      if (p.provider === 'xendit' && (!p.amount || Number(p.amount) <= 0)) { setError('Each plan needs an amount (e.g. 299).'); return; }
      if (p.provider === 'paymongo' && !p.paymongoPlanId.trim() && (!p.amount || Number(p.amount) < 1)) {
        setError('Each plan needs an amount of at least ₱1.00, or the id of a plan you already made in PayMongo.'); return;
      }
    }
    if (provider === 'xendit' && methods.size === 0) { setError('Choose at least one payment method.'); return; }
    let marketBody: Parameters<typeof api.marketplace.updateSettings>[1] | null = null;
    if (provider === 'xendit' && market.enabled) {
      const parsed = parseDraft(market);
      if ('error' in parsed) { setError(parsed.error); return; }
      if (parsed.fee == null) { setError('Set a platform fee to turn marketplace mode on.'); return; }
      marketBody = { enabled: true, feePercent: parsed.fee, minPayout: parsed.minPayout, feeMinPercent: parsed.feeMin, feeMaxPercent: parsed.feeMax };
    }

    setSubmitting(true);
    try {
      const result = await api.apps.register({
        name: name.trim(),
        webhookUrl: webhookUrl.trim() || undefined,
        requiredMetadata: requiredMeta.split(',').map((s) => s.trim()).filter(Boolean),
        optionalMetadata: optionalMeta.split(',').map((s) => s.trim()).filter(Boolean),
        billingMode: 'subscription',
        provider,
        paymentMethods: provider === 'xendit' ? codesFor(methods) : undefined,
        plans: plans.length > 0 ? plans.map(toInlinePlan) : undefined,
      });
      let warning: string | null = null;
      if (marketBody) {
        try { await api.marketplace.updateSettings(result.app.id, marketBody); }
        catch (err) { warning = `The app was created, but marketplace settings were not saved: ${err instanceof Error ? err.message : err}. Set them in App settings.`; }
      }
      setCreated({ appId: result.app.id, apiKey: result.apiKey, webhookSecret: result.webhookSecret, plans: result.plans ?? [], warning });
      setStep('created');
      notifyAppsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register app');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 50,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '5vh 16px', overflowY: 'auto', backdropFilter: 'blur(2px)',
    }}>
      <div
        data-provider={provider ?? undefined}
        data-testid="add-app-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 760, maxWidth: '100%', background: 'var(--surface)', borderRadius: 16,
          boxShadow: 'var(--shadow-2)', overflow: 'hidden',
        }}
      >
        {/* Header band: neutral until a provider is picked, then the provider's brand. */}
        <div style={{
          background: theme ? theme.brand : 'var(--surface-2)',
          color: theme ? theme.onBrand : 'var(--ink)',
          padding: '18px 22px', transition: 'background 200ms',
          borderBottom: theme ? 'none' : '1px solid var(--hairline)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.75 }}>
                {step === 'created' ? 'App registered' : step === 'provider' ? 'Step 1 of 2' : 'Step 2 of 2'}
              </div>
              <h3 style={{ margin: '2px 0 0', fontSize: 19, fontWeight: 700, letterSpacing: -0.3 }}>
                {step === 'provider' ? 'Add an app' : step === 'created' ? (name || 'New app') : `Add a ${theme?.label} app`}
              </h3>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', padding: 6, color: 'inherit', opacity: 0.8 }}>
              <Icon name="x" size={16} />
            </button>
          </div>
          {step === 'form' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
              {PROVIDERS.map((p) => {
                const on = p === provider;
                const ok = configured(p);
                return (
                  <button
                    key={p}
                    onClick={() => ok && pick(p)}
                    disabled={!ok}
                    title={ok ? `Switch to ${PROVIDER_THEME[p].label}` : `${PROVIDER_THEME[p].label} isn't configured yet`}
                    style={{
                      padding: '4px 11px', borderRadius: 999, fontSize: 12, fontWeight: 650,
                      border: '1px solid rgba(255,255,255,0.5)',
                      background: on ? '#fff' : 'rgba(255,255,255,0.18)',
                      color: on ? 'var(--ink)' : 'inherit',
                      opacity: ok ? 1 : 0.5, cursor: ok ? 'pointer' : 'not-allowed',
                    }}
                  >{PROVIDER_THEME[p].label}</button>
                );
              })}
              {provider && (
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: 'rgba(255,255,255,0.25)' }}>
                  {modeOf(provider) === 'live' ? 'LIVE' : modeOf(provider) === 'test' ? 'TEST MODE' : 'MODE UNKNOWN'}
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '18px 22px 22px' }}>
          {step === 'provider' && (
            <ProviderPicker
              loading={integrations.loading && !integrations.data}
              configured={configured}
              onPick={pick}
              onSetUp={(p) => { onClose(); onNavigate('provider-config', p); }}
            />
          )}

          {step === 'form' && provider && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Section title="App details">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="App name" hint="Shown in the dashboard and webhook payloads">
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="BooklyPH" style={inputStyle} autoFocus />
                  </Field>
                  <Field label="Slug" hint="Generated from the name">
                    <input value={slug} readOnly placeholder="booklyph" className="mono" style={{ ...inputStyle, background: 'var(--surface-2)', color: 'var(--muted)' }} />
                  </Field>
                </div>
                <Field label="Webhook URL" hint="AcePay POSTs payment and subscription events here">
                  <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://api.booklyph.com/webhooks/acepay" className="mono" style={inputStyle} />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="Required metadata" hint="Comma-separated; requests missing these are rejected">
                    <input value={requiredMeta} onChange={(e) => setRequiredMeta(e.target.value)} placeholder="user_id" className="mono" style={inputStyle} />
                  </Field>
                  <Field label="Optional metadata" hint="Stored if present">
                    <input value={optionalMeta} onChange={(e) => setOptionalMeta(e.target.value)} placeholder="promo_code" className="mono" style={inputStyle} />
                  </Field>
                </div>
              </Section>

              <Section
                title={plansRequired(provider) ? `${theme!.label} plans` : `${theme!.label} plans (optional)`}
                hint={provider === 'lemonsqueezy' ? 'Paste a variant ID and press Verify.'
                  : provider === 'paymongo' ? 'Only for subscriptions (PayMongo must enable them on your account). One-time payments work without plans.'
                  : 'Only needed for subscriptions. Marketplace and one-time payments work without plans.'}
                action={
                  <Button variant="secondary" size="sm" leading={<Icon name="plus" size={11} strokeWidth={2.4} />}
                    onClick={() => setPlans((p) => [...p, newDraftPlan(provider)])}>
                    Add plan
                  </Button>
                }
              >
                {provider === 'lemonsqueezy' && <HelpBlock />}
                {plans.length === 0 && (
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                    {plansRequired(provider) ? 'Add at least one plan.' : 'No plans — that’s fine. You can add them later from the app’s Plans page.'}
                  </div>
                )}
                {plans.map((p, i) => (
                  <PlanRow
                    key={p.key}
                    index={i + 1}
                    plan={p}
                    onChange={(patch) => updatePlan(p.key, patch)}
                    onVerify={() => verifyPlan(p.key)}
                    onRemove={() => setPlans((prev) => prev.filter((x) => x.key !== p.key))}
                    canRemove={plans.length > 1 || !plansRequired(provider)}
                  />
                ))}
              </Section>

              {provider === 'xendit' && (
                <Section title="Payment methods" hint="What customers can pay with on this app’s checkout.">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {METHOD_GROUPS.map((g) => (
                      <label key={g.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={methods.has(g.key)}
                          style={{ accentColor: 'var(--accent)' }}
                          onChange={() => setMethods((prev) => {
                            const next = new Set(prev);
                            if (next.has(g.key)) next.delete(g.key); else next.add(g.key);
                            return next;
                          })}
                        />
                        {g.label}
                      </label>
                    ))}
                  </div>
                </Section>
              )}

              {provider === 'xendit' && (
                <Section title="Marketplace (optional)" hint="Collect payments for merchants on their own Xendit sub-accounts and keep a platform fee.">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 550 }}>
                    <input type="checkbox" checked={market.enabled} style={{ accentColor: 'var(--accent)' }}
                      onChange={(e) => setMarket((m) => ({ ...m, enabled: e.target.checked }))} />
                    Turn on marketplace mode
                  </label>
                  {market.enabled && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                      <Field label="Platform fee %">
                        <input value={market.feePercent} onChange={(e) => setMarket((m) => ({ ...m, feePercent: e.target.value }))} placeholder="12" className="mono" style={inputStyle} />
                      </Field>
                      <Field label="App may set from %">
                        <input value={market.feeMin} onChange={(e) => setMarket((m) => ({ ...m, feeMin: e.target.value }))} placeholder="—" className="mono" style={inputStyle} />
                      </Field>
                      <Field label="…up to %">
                        <input value={market.feeMax} onChange={(e) => setMarket((m) => ({ ...m, feeMax: e.target.value }))} placeholder="—" className="mono" style={inputStyle} />
                      </Field>
                      <Field label="Min payout (₱)">
                        <input value={market.minPayout} onChange={(e) => setMarket((m) => ({ ...m, minPayout: e.target.value }))} placeholder="500" className="mono" style={inputStyle} />
                      </Field>
                    </div>
                  )}
                </Section>
              )}

              {provider === 'paymongo' && (
                <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                  Checkout methods for PayMongo are set once for the whole account on the{' '}
                  <button onClick={() => { onClose(); onNavigate('provider-config', 'paymongo'); }}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent-text)', fontWeight: 600, cursor: 'pointer' }}>
                    PayMongo config page
                  </button>.
                </div>
              )}

              <div style={{ background: 'var(--accent-soft)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-text)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  Good to know about {theme!.label}
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                  {PROVIDER_NOTES[provider].map((n) => <li key={n}>{n}</li>)}
                </ul>
              </div>

              {error && (
                <div style={{ background: 'var(--bad-soft)', color: 'var(--bad)', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>{error}</div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <Button variant="secondary" onClick={() => setStep('provider')}>Back</Button>
                <Button variant="primary" onClick={register} disabled={submitting} trailing={<Icon name="arrow" size={11} strokeWidth={2.4} />}>
                  {submitting ? 'Registering…' : 'Register and generate keys'}
                </Button>
              </div>
            </div>
          )}

          {step === 'created' && created && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: 'var(--ok-soft)', borderRadius: 10, padding: '12px 14px', display: 'flex', gap: 10 }}>
                <Icon name="check" size={16} color="var(--ok)" strokeWidth={2.4} />
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                  <strong style={{ color: 'var(--ok)' }}>Registered.</strong> Save the API key and webhook secret now — they won&apos;t be shown again.
                </div>
              </div>
              {created.warning && (
                <div style={{ background: 'var(--warn-soft)', color: 'var(--warn)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>{created.warning}</div>
              )}
              <div>
                <CredentialReveal label="API Key" value={created.apiKey} />
                <CredentialReveal label="Webhook Secret" value={created.webhookSecret} />
              </div>
              {created.plans.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {created.plans.length} plan{created.plans.length === 1 ? '' : 's'} created:{' '}
                  {created.plans.map((p) => `${p.name} (${(p.amount / 100).toFixed(2)} ${p.currency}/${p.interval[0]})`).join(', ')}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="primary" onClick={() => onNavigate('app-detail', created.appId)}>
                  I&apos;ve saved them — open the app
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProviderPicker({ loading, configured, onPick, onSetUp }: {
  loading: boolean;
  configured: (p: Provider) => boolean;
  onPick: (p: Provider) => void;
  onSetUp: (p: Provider) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 14 }}>
        Which provider will charge this app&apos;s customers? The form and plans that follow are for that provider.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {PROVIDERS.map((p) => {
          const t = PROVIDER_THEME[p];
          const ok = configured(p);
          return (
            <div
              key={p}
              data-provider={p}
              onClick={() => ok && onPick(p)}
              className={ok ? 'lift' : undefined}
              style={{
                border: '1px solid var(--hairline)', borderRadius: 12, overflow: 'hidden',
                cursor: ok ? 'pointer' : 'default', display: 'flex', flexDirection: 'column',
                opacity: loading ? 0.6 : 1,
              }}
            >
              <div style={{ background: t.brand, color: t.onBrand, padding: '14px 14px 12px' }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,0.28)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12,
                }}>{t.short}</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginTop: 10 }}>{t.label}</div>
              </div>
              <div style={{ padding: '10px 14px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5, flex: 1 }}>{t.bestFor}</div>
                {loading ? (
                  <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Checking…</span>
                ) : ok ? (
                  <Button variant="primary" size="sm">Choose {t.label}</Button>
                ) : (
                  <>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--warn)' }}>Not configured</span>
                    <Button variant="secondary" size="sm" onClick={() => onSetUp(p)}>Set up {t.label} first</Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Section({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--hairline)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '11px 14px', borderBottom: '1px solid var(--hairline)',
        borderLeft: '3px solid var(--accent)', background: 'var(--surface-2)',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 650 }}>{title}</div>
          {hint && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{hint}</div>}
        </div>
        {action}
      </div>
      <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  );
}

function toInlinePlan(p: DraftPlan): InlinePlanInput {
  if (p.provider === 'paymongo') {
    return p.paymongoPlanId.trim()
      ? { provider: 'paymongo', paymongoPlanId: p.paymongoPlanId.trim(), title: p.title.trim(), description: p.description.trim() || undefined, region: p.region }
      : {
          provider: 'paymongo', title: p.title.trim(), description: p.description.trim() || undefined, region: p.region,
          amount: Math.round(Number(p.amount) * 100), currency: 'PHP', interval: p.interval, intervalCount: 1,
        };
  }
  if (p.provider === 'lemonsqueezy') {
    return {
      provider: 'lemonsqueezy', variantId: p.variantId.trim(),
      title: p.title.trim() || (p.verified?.name ?? 'Plan'), description: p.description.trim() || undefined, region: p.region,
    };
  }
  return {
    provider: 'xendit', title: p.title.trim(), description: p.description.trim() || undefined, region: p.region,
    amount: Math.round(Number(p.amount) * 100), currency: p.currency.toUpperCase(), interval: p.interval, intervalCount: 1,
  };
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
        </>
      )}

      {plan.provider === 'paymongo' && (
        <>
          <div style={{ marginTop: 10 }}>
            <Field label="Existing PayMongo plan ID" hint="Optional — leave blank and AcePay creates the plan in PayMongo">
              <input
                value={plan.paymongoPlanId}
                onChange={(e) => onChange({ paymongoPlanId: e.target.value })}
                placeholder="plan_…"
                className="mono"
                style={inputStyle}
              />
            </Field>
          </div>
          {!plan.paymongoPlanId.trim() && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
              <Field label="Amount (PHP)" hint="Major units, at least 1.00">
                <input
                  value={plan.amount}
                  onChange={(e) => onChange({ amount: e.target.value })}
                  type="number" step="0.01" min="1"
                  placeholder="299.00"
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
          )}
        </>
      )}
    </div>
  );
}

