'use client';

import React, { CSSProperties, ReactNode } from 'react';
import { Icon, Sparkline } from './primitives';
import { MovementEvent } from './data';

export const inputStyle: CSSProperties = {
  width: '100%', padding: '8px 11px', fontFamily: 'inherit',
  fontSize: 13, border: '1px solid var(--border)', borderRadius: 6,
  outline: 'none', background: 'var(--surface)', color: 'var(--ink)',
};

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 600, display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function StatCard({ label, value, sub, trend, sparkData, accent, big }: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  trend?: number;
  sparkData?: number[];
  accent?: string;
  big?: boolean;
}) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '14px 16px',
      boxShadow: 'var(--shadow-1)',
      display: 'flex', flexDirection: 'column', gap: 8,
      minHeight: big ? 124 : 100,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: 'var(--muted)',
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>{label}</div>
        {accent && <span style={{ width: 8, height: 8, borderRadius: 8, background: accent }} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: big ? 30 : 24, fontWeight: 600, letterSpacing: -0.6, lineHeight: 1.05, color: 'var(--ink)' }}>
          {value}
        </div>
        {sparkData && <Sparkline data={sparkData} color={accent || 'var(--accent)'} width={92} height={32} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)' }}>
        {trend != null && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 2,
            color: trend >= 0 ? 'var(--ok)' : 'var(--bad)', fontWeight: 600,
          }}>
            <Icon name={trend >= 0 ? 'arrowUp' : 'arrowDn'} size={10} strokeWidth={2.4} />
            {Math.abs(trend)}%
          </span>
        )}
        {sub}
      </div>
    </div>
  );
}

export function MiniStatCard({ label, value, sub, warning, onClick }: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  warning?: boolean;
  onClick?: () => void;
}) {
  return (
    <div onClick={onClick} style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '12px 14px',
      boxShadow: 'var(--shadow-1)', cursor: onClick ? 'pointer' : 'default',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{
        fontSize: 10.5, fontWeight: 600, color: 'var(--muted)',
        textTransform: 'uppercase', letterSpacing: 0.5,
      }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: warning ? 'var(--bad)' : 'var(--ink)' }}>{value}</div>
        {warning && <Icon name="warn" size={13} color="var(--bad)" />}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{sub}</div>
    </div>
  );
}

export function DetailMicro({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ marginTop: 5 }}>{value}</div>
    </div>
  );
}

export function CollapsibleCard({ title, badge, open, onToggle, children }: {
  title: string;
  badge?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-1)',
      overflow: 'hidden',
    }}>
      <button onClick={onToggle} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', background: 'none', border: 'none',
        borderBottom: open ? '1px solid var(--hairline)' : 'none',
        cursor: 'pointer', textAlign: 'left',
      }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
          <Icon name="chevronDown" size={12} color="var(--muted)" style={{ transform: open ? '' : 'rotate(-90deg)', transition: 'transform 150ms' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{title}</span>
          {badge}
        </div>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

export function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="mono" style={{
      margin: 0, padding: '14px 18px',
      background: '#FAF8F1', color: 'var(--ink)',
      fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre',
      overflow: 'auto',
    }}>{children}</pre>
  );
}

export function Modal({ title, onClose, children, width = 460 }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(22,20,15,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 50, backdropFilter: 'blur(2px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width, background: 'var(--surface)', borderRadius: 10,
        boxShadow: 'var(--shadow-2)', padding: '20px 22px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', padding: 4, color: 'var(--muted)' }}>
            <Icon name="x" size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function TablePagination({ total, pageSize = 20 }: { total: number; pageSize?: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 16px', borderTop: '1px solid var(--hairline)',
      fontSize: 12, color: 'var(--muted)',
    }}>
      <span>Showing 1–{Math.min(total, pageSize)} of {total}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button style={{
          padding: '4px 8px', background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 4, fontSize: 11.5, color: 'var(--muted)',
        }}>← Prev</button>
        <span style={{ fontSize: 11.5 }}>1 of 1</span>
        <button style={{
          padding: '4px 8px', background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 4, fontSize: 11.5, color: 'var(--muted)',
        }}>Next →</button>
      </div>
    </div>
  );
}

export function MovementTimeline({ events }: { events: MovementEvent[] }) {
  const statusColors: Record<string, { fg: string; bg: string }> = {
    pending:   { fg: 'var(--warn)',   bg: 'var(--warn-soft)' },
    succeeded: { fg: 'var(--ok)',     bg: 'var(--ok-soft)' },
    failed:    { fg: 'var(--bad)',    bg: 'var(--bad-soft)' },
    refunded:  { fg: 'var(--refund)', bg: 'var(--refund-soft)' },
    active:    { fg: 'var(--ok)',     bg: 'var(--ok-soft)' },
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        position: 'absolute', left: 7, top: 8, bottom: 8,
        width: 1.5, background: 'var(--border)',
      }} />

      {events.map((e, i) => {
        const isTerminal = e.to === 'succeeded' || e.to === 'active';
        const isFail = e.to === 'failed';
        const isCreate = e.from === null;
        const dotColor = isFail ? 'var(--bad)' : isTerminal ? 'var(--ok)' : isCreate ? 'var(--info)' : 'var(--muted-2)';
        const ringColor = dotColor === 'var(--ok)' ? 'var(--ok-soft)'
          : dotColor === 'var(--bad)' ? 'var(--bad-soft)'
          : dotColor === 'var(--info)' ? 'var(--info-soft)'
          : 'var(--border-2)';
        const toColors = statusColors[e.to] || { fg: 'var(--muted)', bg: 'var(--neutral-soft)' };
        const fromColors = e.from ? (statusColors[e.from] || { fg: 'var(--muted)', bg: 'var(--neutral-soft)' }) : null;

        return (
          <div key={i} style={{
            position: 'relative', display: 'grid',
            gridTemplateColumns: '16px 1fr',
            columnGap: 14,
            paddingBottom: i === events.length - 1 ? 0 : 18,
          }}>
            <div style={{
              position: 'relative', zIndex: 1, width: 16, height: 16,
              marginTop: 2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                width: 14, height: 14, borderRadius: 14,
                background: dotColor,
                boxShadow: `0 0 0 3px var(--surface), 0 0 0 4px ${ringColor}`,
              }} />
            </div>

            <div style={{
              background: i === events.length - 1 ? 'var(--surface-2)' : 'transparent',
              borderRadius: 8,
              padding: i === events.length - 1 ? '10px 12px' : '0 4px 0 0',
              border: i === events.length - 1 ? '1px solid var(--hairline)' : 'none',
              marginTop: -2,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }}>{e.time}</span>
                <span className="mono" style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 600 }}>{e.action}</span>

                {(e.from || e.to) && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 4 }}>
                    {e.from && fromColors && (
                      <span style={{
                        padding: '1.5px 7px', borderRadius: 4,
                        background: fromColors.bg, color: fromColors.fg,
                        fontSize: 10.5, fontWeight: 600, letterSpacing: 0.2,
                      }}>{e.from}</span>
                    )}
                    {e.from && e.to && <Icon name="arrow" size={10} color="var(--muted-2)" strokeWidth={2} />}
                    {e.to && (
                      <span style={{
                        padding: '1.5px 7px', borderRadius: 4,
                        background: toColors.bg, color: toColors.fg,
                        fontSize: 10.5, fontWeight: 600, letterSpacing: 0.2,
                      }}>{e.to}</span>
                    )}
                  </span>
                )}
              </div>
              <div style={{
                marginTop: 5, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                fontSize: 11.5, color: 'var(--muted)',
              }}>
                <span><span style={{ color: 'var(--muted-2)' }}>Actor:</span> <span className="mono" style={{ color: 'var(--ink-2)' }}>{e.actor}</span></span>
                <span style={{ color: 'var(--ink-2)' }}>{e.detail}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
