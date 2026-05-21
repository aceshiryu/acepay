'use client';

import React, { ReactNode } from 'react';
import { Card, Icon } from '../primitives';

export function LoadingBlock({ height = 80, label = 'Loading…' }: { height?: number; label?: string }) {
  return (
    <Card padding={16} style={{ height }}>
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--muted-2)', fontSize: 12,
      }}>
        {label}
      </div>
    </Card>
  );
}

export function ErrorBlock({ error, onRetry }: {
  error: Error | { message: string };
  onRetry?: () => void;
}) {
  return (
    <Card padding={16} style={{ borderColor: 'var(--bad-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Icon name="warn" size={16} color="var(--bad)" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--bad)', marginBottom: 4 }}>
            Failed to load
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{error.message}</div>
          {onRetry && (
            <button
              onClick={onRetry}
              style={{
                marginTop: 8, background: 'none', border: 'none', padding: 0,
                fontSize: 12, color: 'var(--accent)', fontWeight: 550, cursor: 'pointer',
              }}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function GuardedView<T>({
  state, render, height = 80,
}: {
  state: { data: T | null; loading: boolean; error: Error | null; refetch: () => void };
  render: (data: T) => ReactNode;
  height?: number;
}) {
  if (state.error) return <ErrorBlock error={state.error} onRetry={state.refetch} />;
  if (state.loading || !state.data) return <LoadingBlock height={height} />;
  return <>{render(state.data)}</>;
}
