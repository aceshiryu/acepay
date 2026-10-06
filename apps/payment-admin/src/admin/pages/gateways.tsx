'use client';

import React from 'react';
import * as api from '../api/client';
import { ProviderHealthRow } from '../api/client';
import { formatRelative } from '../api/format';
import { LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { AddAppTile, AppCard } from '../app-card';
import { PageShell } from '../layout';
import { Button, GatewayCard, HeaderPill, Icon } from '../primitives';
import { Navigate } from '../types';

const PROVIDER_INFO: Record<ProviderHealthRow['provider'], { name: string; color: string; region: string; usedFor: string }> = {
  lemonsqueezy: { name: 'Lemon Squeezy', color: 'var(--brand-lemon)',  region: 'Global',      usedFor: 'Subscriptions · cards' },
  xendit:       { name: 'Xendit',        color: 'var(--brand-xendit)', region: 'Philippines', usedFor: 'Invoices · recurring' },
};

const HEALTH: Record<ProviderHealthRow['status'], { label: string; dot: string }> = {
  ok:             { label: 'Healthy',      dot: 'var(--ok)' },
  no_recent:      { label: 'Quiet',        dot: 'var(--warn)' },
  never_received: { label: 'No webhooks',  dot: 'var(--muted-2)' },
  misconfigured:  { label: 'Needs setup',  dot: 'var(--bad)' },
};

const GRID: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 18,
};

export function GatewaysPage({ onNavigate }: { onNavigate: Navigate }) {
  const health = useFetch(() => api.settings.health(), []);
  const apps = useFetch(() => api.apps.list(), []);
  const appList = apps.data?.data ?? [];

  return (
    <PageShell
      title="Payment Gateway"
      subtitle="The payment providers behind AcePay and the apps connected to it."
      actions={
        <Button variant="primary" leading={<Icon name="plus" size={13} strokeWidth={2.4} />} onClick={() => onNavigate('register-app')}>
          Connect an app
        </Button>
      }
    >
      <Section title="Providers" hint="The payment companies AcePay talks to. Apps never call these directly.">
        {health.loading && <LoadingBlock height={220} />}
        {health.error && <div style={{ color: 'var(--bad)', fontSize: 12 }}>{health.error.message}</div>}
        {health.data && (
          <div style={GRID}>
            {health.data.providers.map((p) => {
              const info = PROVIDER_INFO[p.provider];
              const h = HEALTH[p.status];
              return (
                <GatewayCard
                  key={p.provider}
                  color={info.color}
                  icon={<Icon name={p.provider === 'xendit' ? 'wallet' : 'card'} size={18} color="#fff" strokeWidth={2} />}
                  title={info.name}
                  subtitle={info.region}
                  badge={<HeaderPill dot={h.dot}>{h.label}</HeaderPill>}
                  rows={[
                    { label: 'Used for', value: info.usedFor },
                    { label: 'Config', value: p.envOk
                        ? <span style={{ color: 'var(--ok)' }}>Complete</span>
                        : <span style={{ color: 'var(--bad)' }}>{p.missingEnv.length} missing</span> },
                    { label: 'Webhooks (24h)', value: p.count24h },
                    { label: 'Last webhook', value: formatRelative(p.lastWebhookAt) },
                  ]}
                  action={{ label: 'View transactions', onClick: () => onNavigate('transactions') }}
                  link={{ label: 'Webhook settings', onClick: () => onNavigate('settings') }}
                />
              );
            })}
          </div>
        )}
      </Section>

      <Section title="My apps" hint="Apps connected to AcePay with an API key." last>
        {apps.loading && <LoadingBlock height={200} />}
        {apps.error && <div style={{ color: 'var(--bad)', fontSize: 12 }}>{apps.error.message}</div>}
        {apps.data && (
          <div style={GRID}>
            {appList.map((a) => <AppCard key={a.id} app={a} onNavigate={onNavigate} />)}
            <AddAppTile onClick={() => onNavigate('register-app')} />
          </div>
        )}
      </Section>
    </PageShell>
  );
}

function Section({ title, hint, children, last }: { title: string; hint: string; children: React.ReactNode; last?: boolean }) {
  return (
    <section style={{ marginBottom: last ? 0 : 36 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4, color: 'var(--ink)' }}>{title}</h2>
      <div style={{ fontSize: 13, color: 'var(--muted)', margin: '2px 0 14px' }}>{hint}</div>
      {children}
    </section>
  );
}
