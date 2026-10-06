'use client';

import React from 'react';
import { formatRelative } from './api/format';
import { AppView } from './api/types';
import { GatewayCard, HeaderPill, Icon, appColor } from './primitives';
import { Navigate } from './types';

/** One registered app as a colourful GatewayCard ("My gateways" style). */
export function AppCard({ app, onNavigate, compact }: { app: AppView; onNavigate: Navigate; compact?: boolean }) {
  const letter = (app.name || '?')[0].toUpperCase();
  const rows = compact
    ? [
        { label: 'Status', value: app.isActive ? 'Active' : 'Inactive' },
        { label: 'Webhook', value: app.webhookUrl ? 'Connected' : 'Not set' },
      ]
    : [
        { label: 'Slug', value: <span className="mono" style={{ fontSize: 11.5 }}>{app.slug}</span> },
        { label: 'Webhook', value: app.webhookUrl
            ? <span style={{ color: 'var(--ok)' }}>Connected</span>
            : <span style={{ color: 'var(--muted)' }}>Not set</span> },
        { label: 'Rate limit', value: `${app.rateLimit}/min` },
        { label: 'Created', value: formatRelative(app.createdAt) },
      ];
  return (
    <GatewayCard
      compact={compact}
      color={app.isActive ? appColor(app.name || '?') : 'var(--brand-card)'}
      icon={<span style={{ fontSize: compact ? 14 : 16, fontWeight: 800 }}>{letter}</span>}
      title={app.name}
      subtitle={compact ? undefined : app.code}
      badge={<HeaderPill dot={app.isActive ? 'var(--ok)' : 'var(--muted-2)'}>{app.isActive ? 'Live' : 'Paused'}</HeaderPill>}
      rows={rows}
      onClick={() => onNavigate('app-detail', app.id)}
      action={compact ? undefined : { label: 'Open app', onClick: () => onNavigate('app-detail', app.id) }}
      link={compact ? undefined : { label: 'Transactions', onClick: () => onNavigate('transactions', null, app.id) }}
    />
  );
}

export function AddAppTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="lift"
      style={{
        minHeight: 200, borderRadius: 'var(--radius)',
        border: '2px dashed var(--border)', background: 'transparent',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
        color: 'var(--accent)', fontSize: 13, fontWeight: 650, cursor: 'pointer',
      }}
    >
      <span style={{
        width: 40, height: 40, borderRadius: 12, background: 'var(--accent-soft)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="plus" size={18} color="var(--accent)" strokeWidth={2.4} />
      </span>
      Register a new app
    </button>
  );
}
