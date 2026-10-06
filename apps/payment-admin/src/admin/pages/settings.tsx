'use client';

import React from 'react';
import * as api from '../api/client';
import { formatRelative } from '../api/format';
import { LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { ProviderHealthRow } from '../api/client';
import { PageShell } from '../layout';
import { Button, Card, Icon, ProviderTag } from '../primitives';
import { Navigate } from '../types';

export function SettingsPage({ onNavigate: _ }: { onNavigate: Navigate }) {
  const health = useFetch(() => api.settings.health(), []);
  const [baseUrl, setBaseUrl] = React.useState<string>('');

  React.useEffect(() => {
    if (health.data?.publicBaseHint) {
      setBaseUrl(health.data.publicBaseHint);
    } else if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      // Default to localhost:4001 since that's the gateway dev port.
      setBaseUrl(`${url.protocol}//${url.hostname}:4001`);
    }
  }, [health.data?.publicBaseHint]);

  return (
    <PageShell
      title="Settings"
      breadcrumbs={[{ label: 'Configuration' }, { label: 'Settings' }]}
      actions={
        <Button variant="secondary" size="md"
          leading={<Icon name="refresh" size={12} />}
          onClick={() => health.refetch()}>
          Refresh
        </Button>
      }
    >
      <Card title="Public webhook URL" subtitle="Providers POST events to this URL. If you're running locally, use ngrok or a tunnel and paste the public URL here." padding={16} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://abc123.ngrok.app"
            className="mono"
            style={{
              flex: 1,
              padding: '8px 10px',
              fontSize: 12.5,
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'var(--surface)',
              color: 'var(--ink)',
            }}
          />
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.55 }}>
          Set <span className="mono">PUBLIC_BASE_URL</span> in your gateway <span className="mono">.env</span> to make this auto-fill. (Reminder: only edit <span className="mono">.env.example</span>; mirror the value into <span className="mono">.env</span> yourself.)
        </div>
      </Card>

      {health.loading && <LoadingBlock height={200} />}
      {health.error && <div style={{ padding: 16, color: 'var(--bad)', fontSize: 12 }}>{health.error.message}</div>}
      {health.data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {health.data.providers.map((p) => (
            <ProviderHealthCard
              key={p.provider}
              p={p}
              baseUrl={baseUrl}
              onSimulated={() => health.refetch()}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function ProviderHealthCard({ p, baseUrl, onSimulated }: {
  p: ProviderHealthRow;
  baseUrl: string;
  onSimulated: () => void;
}) {
  const [simulating, setSimulating] = React.useState(false);
  const [simResult, setSimResult] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const fullUrl = `${baseUrl.replace(/\/$/, '')}${p.webhookPath}`;

  const copy = async () => {
    try { await navigator.clipboard.writeText(fullUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ }
  };

  const simulate = async () => {
    setSimulating(true); setSimResult(null);
    try {
      const r = await api.settings.simulateWebhook({ provider: p.provider });
      setSimResult(r.result.duplicate
        ? `✓ Handler ran (duplicate of event ${r.result.eventCode})`
        : r.result.eventId
        ? `✓ Handler ran. Webhook event ${r.result.eventCode} persisted.`
        : `✓ Handler ran but no app matched. Reason: ${r.result.reason ?? 'unknown'}`);
      onSimulated();
    } catch (err) {
      setSimResult(`✗ ${err instanceof Error ? err.message : 'Simulation failed'}`);
    } finally {
      setSimulating(false);
    }
  };

  const verdictStyle = STATUS_STYLES[p.status];

  return (
    <Card padding={0}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', borderBottom: '1px solid var(--hairline)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ProviderTag name={p.provider} />
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '3px 9px', borderRadius: 999,
            background: verdictStyle.bg, color: verdictStyle.fg,
            fontSize: 11, fontWeight: 600, letterSpacing: 0.2,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: verdictStyle.fg, display: 'inline-block' }} />
            {verdictStyle.label}
          </span>
        </div>
        <Button variant="secondary" size="sm" onClick={simulate} disabled={simulating || !p.envOk}>
          {simulating ? 'Simulating…' : 'Simulate webhook'}
        </Button>
      </div>

      <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 10, columnGap: 14, fontSize: 12.5 }}>
        <span style={{ color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: 10.5, letterSpacing: 0.4 }}>
          Webhook URL
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="mono" style={{
            flex: 1, padding: '6px 9px', background: 'var(--surface-2)',
            borderRadius: 4, fontSize: 11.5, color: 'var(--ink-2)',
            overflowX: 'auto', whiteSpace: 'nowrap',
          }}>
            {fullUrl}
          </span>
          <Button variant="ghost" size="sm" onClick={copy}>
            {copied ? '✓ Copied' : 'Copy'}
          </Button>
        </div>

        <span style={{ color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: 10.5, letterSpacing: 0.4 }}>
          Env vars
        </span>
        <div>
          {p.envOk
            ? <span style={{ color: 'var(--ok)', fontWeight: 600 }}>✓ All required env vars set</span>
            : (
              <div>
                <div style={{ color: 'var(--bad)', fontWeight: 600, marginBottom: 4 }}>✗ Missing env vars:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {p.missingEnv.map((k) => (
                    <span key={k} className="mono" style={{
                      padding: '2px 7px', background: 'var(--bad-soft)', color: 'var(--bad)',
                      borderRadius: 3, fontSize: 11,
                    }}>{k}</span>
                  ))}
                </div>
              </div>
            )}
        </div>

        <span style={{ color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: 10.5, letterSpacing: 0.4 }}>
          Last received
        </span>
        <span>
          {p.lastWebhookAt
            ? <span>{formatRelative(p.lastWebhookAt)} <span style={{ color: 'var(--muted)' }}>· {p.count24h} in last 24h</span></span>
            : <span style={{ color: 'var(--muted)' }}>Never. If you&apos;ve already paid a test invoice, the provider can&apos;t reach AcePay — set up a tunnel and configure the URL above in the provider dashboard.</span>}
        </span>
      </div>

      {simResult && (
        <div style={{
          padding: '10px 16px', borderTop: '1px solid var(--hairline)',
          fontSize: 12, background: 'var(--surface-2)',
          color: simResult.startsWith('✓') ? 'var(--ok)' : 'var(--bad)',
        }}>
          {simResult}
        </div>
      )}
    </Card>
  );
}

const STATUS_STYLES: Record<ProviderHealthRow['status'], { label: string; bg: string; fg: string }> = {
  ok:               { label: 'Healthy',            bg: 'var(--ok-soft)',   fg: 'var(--ok)' },
  no_recent:        { label: 'No recent activity', bg: 'var(--warn-soft)', fg: '#A66A00' },
  never_received:   { label: 'Never received',     bg: 'var(--bad-soft)',  fg: 'var(--bad)' },
  misconfigured:    { label: 'Misconfigured',      bg: 'var(--bad-soft)',  fg: 'var(--bad)' },
};
