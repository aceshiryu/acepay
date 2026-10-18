'use client';

import React from 'react';
import * as api from '../api/client';
import { ConnectionCheck, IntegrationCredential, IntegrationRow, ProviderHealthRow, ProviderMode } from '../api/client';
import { formatRelative } from '../api/format';
import { LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { PageShell } from '../layout';
import { Button, Card, CopyButton, Icon } from '../primitives';
import { Navigate } from '../types';
import { Provider } from '../api/types';
import { notifyProvidersChanged } from '../events';
import { PROVIDER_THEME } from '../provider-theme';
import { DefaultsCard } from './marketplace';

const BRAND: Record<IntegrationRow['provider'], { color: string; icon: 'card' | 'wallet' | 'bank' }> = {
  lemonsqueezy: { color: 'var(--brand-lemon)',    icon: 'card' },
  xendit:       { color: 'var(--brand-xendit)',   icon: 'wallet' },
  paymongo:     { color: 'var(--brand-paymongo)', icon: 'bank' },
};

const HEALTH: Record<ProviderHealthRow['status'], { label: string; bg: string; fg: string }> = {
  ok:             { label: 'Webhooks healthy',   bg: 'var(--ok-soft)',   fg: 'var(--ok)' },
  no_recent:      { label: 'No recent webhooks', bg: 'var(--warn-soft)', fg: '#A66A00' },
  never_received: { label: 'No webhooks yet',    bg: 'var(--bad-soft)',  fg: 'var(--bad)' },
  misconfigured:  { label: 'Needs setup',        bg: 'var(--bad-soft)',  fg: 'var(--bad)' },
};

const MODE: Record<ProviderMode, { label: string; bg: string; fg: string }> = {
  test:    { label: 'Test mode', bg: 'var(--warn-soft)', fg: '#A66A00' },
  live:    { label: 'Live',      bg: 'var(--ok-soft)',   fg: 'var(--ok)' },
  unknown: { label: 'Mode unknown', bg: 'var(--surface-2)', fg: 'var(--muted)' },
};

const LABEL: React.CSSProperties = {
  color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: 10.5, letterSpacing: 0.4,
};

/**
 * One provider's config page (sidebar → Provider config): whether it's
 * configured, test vs live, the webhook URLs to paste into the provider, and
 * buttons to prove the keys and the webhook chain work. Keys can be saved here
 * (encrypted in the database, overriding .env) or left in the gateway .env.
 * Credentials belong to the provider account, so every app on it shares them.
 */
export function ProviderConfigPage({ provider, onNavigate: _ }: { provider: Provider; onNavigate: Navigate }) {
  const list = useFetch(() => api.integrations.list(), []);
  const baseUrl = usePublicBaseUrl(list.data?.publicBaseHint ?? null);
  const [base, setBase] = React.useState('');
  React.useEffect(() => setBase(baseUrl), [baseUrl]);
  const theme = PROVIDER_THEME[provider];
  const row = list.data?.integrations.find((i) => i.provider === provider) ?? null;
  const changed = () => { list.refetch(); notifyProvidersChanged(); };

  return (
    <div data-provider={provider} style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      <PageShell
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              width: 30, height: 30, borderRadius: 9, background: theme.brand, color: theme.onBrand,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800,
            }}>{theme.short}</span>
            {theme.label} config
            {row && (
              <span data-testid="configured-pill" style={{
                fontSize: 11.5, fontWeight: 650, padding: '3px 10px', borderRadius: 999,
                background: row.configured ? 'var(--ok-soft)' : 'var(--warn-soft)',
                color: row.configured ? 'var(--ok)' : 'var(--warn)',
              }}>{row.configured ? 'Configured' : 'Not configured'}</span>
            )}
          </span>
        }
        subtitle={`Shared by every ${theme.label} app. Apps never call ${theme.label} directly.`}
        breadcrumbs={[{ label: 'Provider config' }, { label: theme.label }]}
        actions={
          <Button variant="secondary" size="md" leading={<Icon name="refresh" size={12} />} onClick={() => list.refetch()}>
            Refresh
          </Button>
        }
      >
        {list.loading && !list.data && <LoadingBlock height={260} />}
        {list.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{list.error.message}</div>}
        {row && !row.configured && (
          <div style={{
            background: 'var(--warn-soft)', borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: 16,
            fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55,
          }}>
            <strong style={{ color: 'var(--warn)' }}>Not configured.</strong>{' '}
            Missing: {row.credentials.filter((c) => c.required && !c.set).map((c) => c.label).join(', ')}.
            Apps can&apos;t be added under {theme.label} until these are saved.
          </div>
        )}
        {row && <IntegrationCard i={row} baseUrl={base} onChanged={changed} />}

        <Card title="Public webhook URL" subtitle="Providers send events to this address. Running locally? Start a tunnel (e.g. ngrok) and paste its URL here." padding={16} style={{ marginTop: 16 }}>
          <input
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder="https://abc123.ngrok.app"
            className="mono"
            style={{
              width: '100%', padding: '8px 10px', fontSize: 12.5,
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--surface)', color: 'var(--ink)',
            }}
          />
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.55 }}>
            Set <span className="mono">PUBLIC_BASE_URL</span> in the gateway <span className="mono">.env</span> to make this fill in automatically.
          </div>
        </Card>

        {provider === 'xendit' && (
          <div style={{ marginTop: 16 }}>
            <DefaultsCard />
          </div>
        )}
      </PageShell>
    </div>
  );
}

/** The gateway's public base URL: PUBLIC_BASE_URL if set, else this host on the gateway dev port. */
export function usePublicBaseUrl(hint: string | null): string {
  const [base, setBase] = React.useState('');
  React.useEffect(() => {
    if (hint) setBase(hint);
    else if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      setBase(`${url.protocol}//${url.hostname}:4001`);
    }
  }, [hint]);
  return base;
}

function Pill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 999,
      background: bg, color: fg, fontSize: 11, fontWeight: 600, letterSpacing: 0.2, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: fg, display: 'inline-block' }} />
      {label}
    </span>
  );
}

function IntegrationCard({ i, baseUrl, onChanged }: { i: IntegrationRow; baseUrl: string; onChanged: () => void }) {
  const [testing, setTesting] = React.useState(false);
  const [check, setCheck] = React.useState<ConnectionCheck | null>(null);
  const [simulating, setSimulating] = React.useState(false);
  const [simResult, setSimResult] = React.useState<string | null>(null);
  const brand = BRAND[i.provider];
  const base = baseUrl.replace(/\/$/, '');

  const test = async () => {
    setTesting(true); setCheck(null);
    try {
      setCheck(await api.integrations.test(i.provider));
    } catch (err) {
      setCheck({ ok: false, mode: i.mode, detail: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  const simulate = async () => {
    setSimulating(true); setSimResult(null);
    try {
      const r = await api.settings.simulateWebhook({ provider: i.provider });
      setSimResult(r.result.duplicate
        ? `✓ Handler ran (duplicate of event ${r.result.eventCode})`
        : r.result.eventId
        ? `✓ Handler ran. Webhook event ${r.result.eventCode} saved.`
        : `✓ Handler ran but no app matched. Reason: ${r.result.reason ?? 'unknown'}`);
      onChanged();
    } catch (err) {
      setSimResult(`✗ ${err instanceof Error ? err.message : 'Simulation failed'}`);
    } finally {
      setSimulating(false);
    }
  };

  return (
    <Card padding={0}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        padding: '14px 16px', borderBottom: '1px solid var(--hairline)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: brand.color, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name={brand.icon} size={18} color="#fff" strokeWidth={2} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{i.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{i.region} · {i.usedFor}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {i.configured
              ? <Pill label="Connected" bg="var(--ok-soft)" fg="var(--ok)" />
              : <Pill label="Not connected" bg="var(--bad-soft)" fg="var(--bad)" />}
            {i.configured && <Pill {...MODE[i.mode]} />}
            {i.configured && <Pill {...HEALTH[i.health.status]} />}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" size="sm" onClick={test} disabled={testing || !i.configured}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          <Button variant="secondary" size="sm" onClick={simulate} disabled={simulating || !i.configured}
            title="Sends a fake, correctly signed webhook through AcePay's own receiver">
            {simulating ? 'Simulating…' : 'Simulate webhook'}
          </Button>
          <Button variant="ghost" size="sm" trailing={<Icon name="ext" size={11} />}
            onClick={() => window.open(i.dashboardUrl, '_blank', 'noopener,noreferrer')}>
            Dashboard
          </Button>
        </div>
      </div>

      {(check || simResult) && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--hairline)', background: 'var(--surface-2)', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {check && (
            <span style={{ color: check.ok ? 'var(--ok)' : 'var(--bad)' }}>
              {check.ok ? '✓' : '✗'} {check.detail}
            </span>
          )}
          {simResult && <span style={{ color: simResult.startsWith('✓') ? 'var(--ok)' : 'var(--bad)' }}>{simResult}</span>}
        </div>
      )}

      <CredentialsSection i={i} onSaved={onChanged} />

      <div style={{ padding: '14px 16px', borderTop: '1px solid var(--hairline)' }}>
        <div style={{ ...LABEL, marginBottom: 8 }}>Webhooks <span style={{ textTransform: 'none', fontWeight: 500 }}>· paste into {i.name}</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {i.webhooks.map((w) => (
            <div key={w.path}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 5 }}>{w.label}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="mono" style={{
                  flex: 1, minWidth: 0, padding: '6px 9px', background: 'var(--surface-2)', borderRadius: 4,
                  fontSize: 11.5, color: 'var(--ink-2)', overflowX: 'auto', whiteSpace: 'nowrap',
                }}>{base}{w.path}</span>
                <CopyButton value={`${base}${w.path}`} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                {w.events.map((e) => (
                  <span key={e} className="mono" style={{
                    padding: '2px 7px', background: 'var(--surface-2)', color: 'var(--muted)', borderRadius: 3, fontSize: 10.5,
                  }}>{e}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, marginTop: 12, color: 'var(--ink-2)' }}>
          <span style={LABEL}>Last received&nbsp;&nbsp;</span>
          {i.health.lastWebhookAt
            ? <>{formatRelative(i.health.lastWebhookAt)} <span style={{ color: 'var(--muted)' }}>· {i.health.count24h} in the last 24h</span></>
            : <span style={{ color: 'var(--muted)' }}>Never. If you&apos;ve already paid a test checkout, {i.name} can&apos;t reach AcePay. Check the URL above is saved in its dashboard.</span>}
        </div>
      </div>
    </Card>
  );
}

const SOURCE_LABEL: Record<'database' | 'env', string> = { database: 'Saved in AcePay', env: 'From .env' };

/**
 * View mode lists each credential (secrets masked) and where it comes from.
 * Edit mode: type a new value to save it (encrypted; it overrides .env), or
 * remove a saved value to fall back to .env. Blank fields are left unchanged,
 * so editing one key never requires re-typing the others.
 */
function CredentialsSection({ i, onSaved }: { i: IntegrationRow; onSaved: () => void }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [clearing, setClearing] = React.useState<Record<string, boolean>>({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedNote, setSavedNote] = React.useState<string | null>(null);

  const reset = () => { setDraft({}); setClearing({}); setError(null); };
  const changes: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(draft)) if (v.trim()) changes[k] = v.trim();
  for (const [k, on] of Object.entries(clearing)) if (on && !(k in changes)) changes[k] = null;
  const changeCount = Object.keys(changes).length;

  const save = async () => {
    setSaving(true); setError(null);
    try {
      await api.integrations.saveCredentials(i.provider, changes);
      setSavedNote(`Saved ${changeCount} change${changeCount === 1 ? '' : 's'}. The worker picks them up within 30 seconds.`);
      reset(); setEditing(false); onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <div style={LABEL}>Credentials</div>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={() => { setEditing(true); setSavedNote(null); }}>Edit</Button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {i.credentials.map((c, idx) => (
          <div key={c.env} style={{
            display: 'grid', gridTemplateColumns: 'minmax(150px, 220px) 1fr', gap: '4px 14px', alignItems: 'baseline',
            padding: '9px 0', borderTop: idx === 0 ? 'none' : '1px solid var(--hairline)',
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                {c.label}{!c.required && <span style={{ fontWeight: 500, color: 'var(--muted)' }}> · optional</span>}
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{c.env}</div>
            </div>
            <div style={{ minWidth: 0 }}>
              {editing
                ? <CredentialInput c={c} value={draft[c.env] ?? ''} clearing={!!clearing[c.env]}
                    onChange={(v) => setDraft((d) => ({ ...d, [c.env]: v }))}
                    onToggleClear={() => setClearing((x) => ({ ...x, [c.env]: !x[c.env] }))} />
                : <CredentialValue c={c} />}
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2, lineHeight: 1.45 }}>{c.hint}</div>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 }}>
            Saved values are encrypted and override the gateway <span className="mono">.env</span>. Blank fields stay as they are.
          </div>
          {error && <div style={{ color: 'var(--bad)', fontSize: 12 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" size="sm" onClick={() => { reset(); setEditing(false); }}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={save} disabled={saving || changeCount === 0}>
              {saving ? 'Saving…' : changeCount ? `Save ${changeCount} change${changeCount === 1 ? '' : 's'}` : 'Save'}
            </Button>
          </div>
        </div>
      )}
      {savedNote && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ok)' }}>✓ {savedNote}</div>}

      {i.recentChanges.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
          <span style={LABEL}>Recent changes&nbsp;&nbsp;</span>
          {i.recentChanges.map((ch, n) => (
            <span key={`${ch.key}-${ch.createdAt}`}>
              {n > 0 && ' · '}
              <span className="mono">{ch.key}</span> {ch.action === 'set' ? 'saved' : 'removed'}
              {ch.actor ? ` by ${ch.actor}` : ''} {formatRelative(ch.createdAt)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CredentialValue({ c }: { c: IntegrationCredential }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
      {c.set
        ? <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)', overflowWrap: 'anywhere' }}>{c.preview}</span>
        : <span style={{ fontSize: 12, fontWeight: 600, color: c.required ? 'var(--bad)' : 'var(--muted)' }}>
            {c.required ? '✗ Not set' : 'Not set'}
          </span>}
      {c.source && (
        <span style={{
          fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 999,
          background: c.source === 'database' ? 'var(--accent-soft)' : 'var(--surface-2)',
          color: c.source === 'database' ? 'var(--accent)' : 'var(--muted)',
        }}>
          {SOURCE_LABEL[c.source]}
        </span>
      )}
      {c.source === 'database' && c.updatedAt && (
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {c.updatedBy ? `by ${c.updatedBy} ` : ''}{formatRelative(c.updatedAt)}
        </span>
      )}
    </div>
  );
}

function CredentialInput({ c, value, clearing, onChange, onToggleClear }: {
  c: IntegrationCredential;
  value: string;
  clearing: boolean;
  onChange: (v: string) => void;
  onToggleClear: () => void;
}) {
  const placeholder = c.set
    ? `Leave blank to keep ${c.secret ? c.preview : 'the current value'}`
    : `Not set${c.required ? ' (required)' : ''}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <input
        type={c.secret ? 'password' : 'text'}
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={clearing}
        onChange={(e) => onChange(e.target.value)}
        placeholder={clearing ? 'Will be removed on save' : placeholder}
        className="mono"
        style={{
          width: '100%', padding: '7px 9px', fontSize: 12, borderRadius: 6,
          border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)',
        }}
      />
      {c.source === 'database' && (
        <button type="button" onClick={onToggleClear} style={{
          alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          fontSize: 11.5, fontWeight: 600, color: clearing ? 'var(--muted)' : 'var(--bad)',
        }}>
          {clearing
            ? 'Undo remove'
            : c.envFallback ? 'Remove saved value (use the .env value)' : 'Remove saved value'}
        </button>
      )}
    </div>
  );
}
