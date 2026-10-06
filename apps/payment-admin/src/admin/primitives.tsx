'use client';

import React, { CSSProperties, ReactNode } from 'react';

export const STATUS_MAP: Record<string, { label: string; fg: string; bg: string; dot: string }> = {
  pending:   { label: 'Pending',   fg: 'var(--warn)',   bg: 'var(--warn-soft)',   dot: '#D89B3C' },
  succeeded: { label: 'Succeeded', fg: 'var(--ok)',     bg: 'var(--ok-soft)',     dot: '#2F7D52' },
  failed:    { label: 'Failed',    fg: 'var(--bad)',    bg: 'var(--bad-soft)',    dot: '#B32D2E' },
  refunded:  { label: 'Refunded',  fg: 'var(--refund)', bg: 'var(--refund-soft)', dot: '#B36A21' },
  active:    { label: 'Active',    fg: 'var(--ok)',     bg: 'var(--ok-soft)',     dot: '#2F7D52' },
  past_due:  { label: 'Past Due',  fg: 'var(--warn)',   bg: 'var(--warn-soft)',   dot: '#D89B3C' },
  canceled:  { label: 'Canceled',  fg: 'var(--muted)',  bg: 'var(--neutral-soft)', dot: '#A8A294' },
  paused:    { label: 'Paused',    fg: 'var(--info)',   bg: 'var(--info-soft)',   dot: '#3D5BA9' },
  expired:   { label: 'Expired',   fg: 'var(--muted)',  bg: 'var(--neutral-soft)', dot: '#A8A294' },
  delivered: { label: 'Delivered', fg: 'var(--ok)',     bg: 'var(--ok-soft)',     dot: '#2F7D52' },
  exhausted: { label: 'Exhausted', fg: 'var(--bad)',    bg: 'var(--bad-soft)',    dot: '#B32D2E' },
  inactive:  { label: 'Inactive',  fg: 'var(--muted)',  bg: 'var(--neutral-soft)', dot: '#A8A294' },
  // Marketplace merchants + payout runs / payouts
  suspended:  { label: 'Suspended',  fg: 'var(--bad)',   bg: 'var(--bad-soft)',     dot: '#B32D2E' },
  building:   { label: 'Building',   fg: 'var(--info)',  bg: 'var(--info-soft)',    dot: '#3D5BA9' },
  build_failed: { label: 'Build failed', fg: 'var(--bad)', bg: 'var(--bad-soft)',   dot: '#B32D2E' },
  draft:      { label: 'Draft',      fg: 'var(--ink-2)', bg: 'var(--neutral-soft)', dot: '#7A7568' },
  queued:     { label: 'Queued',     fg: 'var(--info)',  bg: 'var(--info-soft)',    dot: '#3D5BA9' },
  processing: { label: 'Processing', fg: 'var(--warn)',  bg: 'var(--warn-soft)',    dot: '#D89B3C' },
  completed:  { label: 'Completed',  fg: 'var(--ok)',    bg: 'var(--ok-soft)',      dot: '#2F7D52' },
  completed_with_failures: { label: 'Some failed', fg: 'var(--warn)', bg: 'var(--warn-soft)', dot: '#B32D2E' },
  discarded:  { label: 'Discarded',  fg: 'var(--muted)', bg: 'var(--neutral-soft)', dot: '#A8A294' },
  reversed:   { label: 'Reversed',   fg: 'var(--bad)',   bg: 'var(--bad-soft)',     dot: '#B32D2E' },
  skipped:    { label: 'Skipped',    fg: 'var(--muted)', bg: 'var(--neutral-soft)', dot: '#A8A294' },
};

export function StatusBadge({ status, size = 'md' }: { status: string; size?: 'sm' | 'md' }) {
  const s = STATUS_MAP[status] || STATUS_MAP.pending;
  const pad = size === 'sm' ? '2px 7px' : '3px 8px 3px 7px';
  const fs = size === 'sm' ? 11 : 11.5;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: pad, borderRadius: 999, background: s.bg, color: s.fg,
      fontSize: fs, fontWeight: 550, letterSpacing: 0.1,
      lineHeight: 1, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 5, background: s.dot }} />
      {s.label}
    </span>
  );
}

export function ProviderTag({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const p = (name || '').toLowerCase();
  const styles = p === 'lemonsqueezy'
    ? { bg: 'var(--lemon-bg)', fg: 'var(--lemon-ink)', label: 'Lemon Squeezy' }
    : p === 'xendit'
    ? { bg: 'var(--xendit-bg)', fg: 'var(--xendit-ink)', label: 'Xendit' }
    : { bg: 'var(--neutral-soft)', fg: 'var(--ink-2)', label: name };
  const pad = size === 'sm' ? '1px 8px' : '2px 9px';
  const fs = size === 'sm' ? 10.5 : 11;
  return (
    <span style={{
      display: 'inline-block', padding: pad, borderRadius: 999,
      background: styles.bg, color: styles.fg,
      fontSize: fs, fontWeight: 600, letterSpacing: 0.1, lineHeight: 1.4,
    }}>{styles.label}</span>
  );
}

export function SourceTag({ source }: { source: string }) {
  const isMobile = source === 'mobile';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5,
      color: 'var(--muted)', fontWeight: 500,
    }}>
      <Icon name={isMobile ? 'mobile' : 'web'} size={11} />
      {isMobile ? 'Mobile' : 'Web'}
    </span>
  );
}

export function TypePill({ type }: { type: string }) {
  const map: Record<string, { label: string; fg: string; bg: string }> = {
    payment:      { label: 'payment',      fg: 'var(--ink-2)', bg: 'var(--neutral-soft)' },
    refund:       { label: 'refund',       fg: '#B36A21',      bg: 'var(--refund-soft)' },
    subscription: { label: 'subscription', fg: '#5851B0',      bg: '#EBE7F4' },
  };
  const t = map[type] || map.payment;
  return (
    <span className="mono" style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 4,
      background: t.bg, color: t.fg, fontSize: 11, fontWeight: 500,
    }}>{t.label}</span>
  );
}

type ButtonProps = {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'block';
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
  style?: CSSProperties;
  disabled?: boolean;
  title?: string;
};

export function Button({ children, variant = 'secondary', size = 'md', onClick, leading, trailing, style, disabled, title }: ButtonProps) {
  const variants = {
    primary:   { bg: 'var(--accent)',  fg: 'var(--accent-ink)', border: 'var(--accent)' },
    secondary: { bg: 'var(--surface)', fg: 'var(--ink)',        border: 'var(--border)' },
    ghost:     { bg: 'transparent',    fg: 'var(--ink-2)',      border: 'transparent' },
    danger:    { bg: 'var(--surface)', fg: 'var(--bad)',        border: 'var(--border)' },
    block:     { bg: 'var(--surface)', fg: 'var(--ink)',        border: 'var(--border)' },
  } as const;
  const v = variants[variant];
  const sizes = {
    sm: { padding: '4px 11px', fontSize: 12,   h: 30 },
    md: { padding: '7px 16px', fontSize: 13,   h: 38 },
    lg: { padding: '9px 20px', fontSize: 14,   h: 44 },
  } as const;
  const sz = sizes[size];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: sz.h,
        padding: sz.padding, fontSize: variant === 'block' ? 12 : sz.fontSize, fontWeight: 600,
        background: v.bg, color: v.fg, border: `1px solid ${v.border}`,
        borderRadius: 10, transition: 'all 120ms', whiteSpace: 'nowrap',
        boxShadow: variant === 'primary' ? '0 6px 16px -8px rgba(79,124,247,0.7)' : 'none',
        ...(variant === 'block' ? { width: '100%', textTransform: 'uppercase' as const, letterSpacing: 0.6 } : {}),
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        ...style,
      }}
    >
      {leading}{children}{trailing}
    </button>
  );
}

type CardProps = {
  children: ReactNode;
  style?: CSSProperties;
  padding?: number;
  title?: ReactNode;
  action?: ReactNode;
  subtitle?: ReactNode;
};

export function Card({ children, style, padding = 16, title, action, subtitle }: CardProps) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--hairline)',
      borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-1)',
      ...style,
    }}>
      {(title || action) && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '16px 20px', borderBottom: '1px solid var(--hairline)',
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--ink)', letterSpacing: -0.2 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{subtitle}</div>}
          </div>
          {action}
        </div>
      )}
      <div style={{ padding: title ? 0 : padding }}>{children}</div>
    </div>
  );
}

type IconName =
  | 'dash' | 'apps' | 'tx' | 'sub' | 'cust' | 'hook' | 'log'
  | 'search' | 'plus' | 'chevron' | 'chevronDown'
  | 'arrow' | 'arrowUp' | 'arrowDn' | 'ext' | 'copy' | 'refresh'
  | 'bell' | 'settings' | 'mobile' | 'web' | 'check' | 'x' | 'clock'
  | 'warn' | 'skull' | 'filter' | 'download' | 'play' | 'pause'
  | 'spade' | 'eye' | 'more' | 'plus_thin'
  | 'card' | 'wallet' | 'bank' | 'store' | 'grid' | 'list';

type IconProps = {
  name: IconName | string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
};

export function Icon({ name, size = 14, color = 'currentColor', strokeWidth = 1.6, style }: IconProps) {
  const sw = strokeWidth;
  const common = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: color, strokeWidth: sw, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    style: { flexShrink: 0, display: 'block', ...style },
  };
  const paths: Record<string, ReactNode> = {
    dash: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    apps: <><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4" /><path d="M4 17l8 4 8-4" /></>,
    tx: <><path d="M7 7h13M7 7l3-3M7 7l3 3" /><path d="M17 17H4M17 17l-3-3M17 17l-3 3" /></>,
    sub: <><path d="M21 12a9 9 0 1 1-9-9" /><path d="M21 4v5h-5" /></>,
    cust: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></>,
    hook: <><path d="M18 9a4 4 0 1 0-7.5 2L7 17H4" /><path d="M8 14l-4 7" /><circle cx="14" cy="14" r="3" /></>,
    log: <><path d="M4 6h16M4 12h16M4 18h10" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    chevron: <><path d="m9 6 6 6-6 6" /></>,
    chevronDown: <><path d="m6 9 6 6 6-6" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    arrowUp: <><path d="M12 19V5M6 11l6-6 6 6" /></>,
    arrowDn: <><path d="M12 5v14M6 13l6 6 6-6" /></>,
    ext: <><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M20 14v6H4V4h6" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    refresh: <><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></>,
    bell: <><path d="M6 8a6 6 0 1 1 12 0c0 6 3 7 3 7H3s3-1 3-7" /><path d="M10 21a2 2 0 0 0 4 0" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
    mobile: <><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M11 18h2" /></>,
    web: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
    check: <><path d="m5 12 5 5L20 6" /></>,
    x: <><path d="M18 6 6 18M6 6l12 12" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    warn: <><path d="M12 9v4M12 17h.01M10.3 4.5 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.5a2 2 0 0 0-3.4 0z" /></>,
    skull: <><path d="M8 14v3M16 14v3M12 16v2" /><circle cx="9" cy="11" r="1.5" /><circle cx="15" cy="11" r="1.5" /><path d="M3 11a9 9 0 1 1 18 0v3a3 3 0 0 1-3 3h-1v3H7v-3H6a3 3 0 0 1-3-3v-3z" /></>,
    filter: <><path d="M3 5h18l-7 9v6l-4-2v-4L3 5z" /></>,
    download: <><path d="M12 3v12M6 11l6 6 6-6M4 21h16" /></>,
    play: <><path d="m6 4 14 8-14 8z" /></>,
    pause: <><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>,
    spade: <><path d="M12 2c3 4 7 7 7 11a4 4 0 0 1-7 2.7V18h-1v-2.3A4 4 0 0 1 5 13c0-4 4-7 7-11z" /><path d="M10 21h4" /><path d="M12 18v3" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
    more: <><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>,
    plus_thin: <><path d="M12 5v14M5 12h14" /></>,
    card: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></>,
    wallet: <><path d="M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6" /><circle cx="16.5" cy="13.5" r="1.2" /></>,
    bank: <><path d="M3 10 12 4l9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 21h18" /></>,
    store: <><path d="M4 9 5.5 4h13L20 9" /><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9" /><path d="M5 11v9h14v-9" /><path d="M10 20v-5h4v5" /></>,
    grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
    list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  };
  return <svg {...common}>{paths[name] || null}</svg>;
}

export function AceLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size * (28 / 22)} viewBox="0 0 22 28" fill="none">
      <rect x="0.6" y="0.6" width="20.8" height="26.8" rx="3.4" fill="var(--accent)" />
      <rect x="0.6" y="0.6" width="20.8" height="26.8" rx="3.4" stroke="var(--accent)" />
      <text x="4" y="11" fontFamily="var(--font-serif)" fontSize="11" fill="var(--accent-ink)" fontWeight="400">A</text>
      <path d="M11 13c1.5 2 3.5 3.5 3.5 5.5a1.8 1.8 0 0 1-3.5 1V22h-1v-2.5a1.8 1.8 0 0 1-3.5-1c0-2 2-3.5 3.5-5.5z" fill="var(--accent-ink)" opacity="0.95" />
    </svg>
  );
}

export function Sparkline({ data, color = 'var(--accent)', width = 100, height = 28, fill = true }: {
  data: number[]; color?: string; width?: number; height?: number; fill?: boolean;
}) {
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return [x, y] as const;
  });
  const path = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const area = `${path} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {fill && <path d={area} fill={color} opacity="0.10" />}
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function SectionHeader({ title, action, count }: { title: string; action?: ReactNode; count?: number | null }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      marginBottom: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', letterSpacing: 0.2, textTransform: 'uppercase' }}>{title}</h3>
        {count != null && <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{count}</span>}
      </div>
      {action}
    </div>
  );
}

/**
 * Copies `value` to the clipboard and says so for a moment. The label is the
 * button's accessible name (it shows only an icon).
 */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (no https / permission): the value is still selectable */
    }
  };
  return (
    <button type="button" onClick={() => void copy()} aria-label={copied ? 'Copied' : label} title={copied ? 'Copied' : label}
      style={{ background: 'none', border: 'none', padding: 4, color: copied ? 'var(--ok)' : 'var(--muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5 }}>
      <Icon name={copied ? 'check' : 'copy'} size={12} />
      {copied ? 'Copied' : null}
    </button>
  );
}

export function KV({ k, v, mono = false, copy = false }: { k: string; v: ReactNode; mono?: boolean; copy?: boolean }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '130px 1fr',
      padding: '7px 0', borderBottom: '1px solid var(--hairline)',
      alignItems: 'baseline',
    }}>
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>{k}</div>
      <div style={{
        color: 'var(--ink)', fontSize: 12.5,
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
        {copy && typeof v === 'string' && <CopyButton value={v} label={`Copy ${k}`} />}
      </div>
    </div>
  );
}

export type Column<T> = {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  wrap?: boolean;
  render?: (row: T) => ReactNode;
};

export function Table<T>({ columns, rows, onRowClick, getRowKey, dense = false }: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  getRowKey?: (row: T) => string | number;
  dense?: boolean;
}) {
  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} style={{
                textAlign: c.align || 'left',
                padding: dense ? '9px 12px' : '11px 20px',
                fontSize: 11, fontWeight: 600, color: 'var(--muted)',
                borderBottom: '1px solid var(--hairline)',
                background: 'var(--surface-2)',
                textTransform: 'uppercase', letterSpacing: 0.4,
                whiteSpace: 'nowrap',
                width: c.width,
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={getRowKey ? getRowKey(row) : i}
              onClick={() => onRowClick && onRowClick(row)}
              style={{
                cursor: onRowClick ? 'pointer' : 'default',
                transition: 'background 100ms',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F5F8FF')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              {columns.map(c => (
                <td key={c.key} style={{
                  padding: dense ? '10px 12px' : '14px 20px',
                  borderBottom: '1px solid var(--hairline)',
                  textAlign: c.align || 'left',
                  whiteSpace: c.wrap ? 'normal' : 'nowrap',
                  verticalAlign: 'middle',
                }}>
                  {c.render ? c.render(row) : (row as Record<string, ReactNode>)[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FilterSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: (string | { value: string; label: string })[];
  onChange?: (v: string) => void;
}) {
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 8px 5px 10px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10, fontSize: 12, color: 'var(--ink-2)',
      cursor: 'pointer',
    }}>
      <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{label}</span>
      <select
        value={value}
        onChange={e => onChange && onChange(e.target.value)}
        style={{
          appearance: 'none', WebkitAppearance: 'none',
          background: 'transparent', border: 'none', outline: 'none',
          fontFamily: 'inherit', fontSize: 12, color: 'var(--ink)', fontWeight: 500,
          paddingRight: 14,
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2.5' stroke-linecap='round'><path d='m6 9 6 6 6-6'/></svg>")`,
          backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0 center',
          cursor: 'pointer',
        }}
      >
        {options.map(o => {
          const v = typeof o === 'object' ? o.value : o;
          const l = typeof o === 'object' ? o.label : o;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', width = 220 }: {
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  width?: number;
}) {
  return (
    <div style={{
      position: 'relative', display: 'inline-flex', alignItems: 'center',
      width,
    }}>
      <span style={{ position: 'absolute', left: 9, color: 'var(--muted-2)', display: 'flex' }}>
        <Icon name="search" size={13} />
      </span>
      <input
        value={value || ''}
        onChange={e => onChange && onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '9px 12px 9px 32px',
          fontFamily: 'inherit', fontSize: 13,
          border: '1px solid var(--border)', borderRadius: 10,
          background: 'var(--surface)', color: 'var(--ink)',
          outline: 'none',
        }}
        onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
        onBlur={e => (e.target.style.borderColor = 'var(--border)')}
      />
    </div>
  );
}

// Friendly, saturated palette for app identity (avatars + GatewayCard headers).
export const APP_PALETTE = ['#4F7CF7', '#1FB563', '#7C5CF5', '#F59E0B', '#E8559B', '#0EA5E9', '#F97316', '#14B8A6'];

export function appColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return APP_PALETTE[h % APP_PALETTE.length];
}

export function AppAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const c = appColor(name || '?');
  const letter = (name || '?')[0];
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.3,
      background: c,
      color: '#fff', fontWeight: 700, fontSize: size * 0.42,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      letterSpacing: -0.3,
    }}>{letter.toUpperCase()}</div>
  );
}

export type GatewayRow = { label: string; value: ReactNode };

/**
 * The colourful "gateway" card: brand-coloured header strip with an icon tile
 * and title, then label/value rows, then an optional full-width action and a
 * small centred link. Used for providers, payment methods and apps.
 */
export function GatewayCard({ color, icon, title, subtitle, badge, rows, action, link, onClick, compact }: {
  color: string;
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  rows: GatewayRow[];
  action?: { label: string; onClick: () => void };
  link?: { label: string; onClick: () => void };
  onClick?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={onClick ? 'lift' : undefined}
      onClick={onClick}
      style={{
        background: 'var(--surface)', borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-1)', border: '1px solid var(--hairline)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        cursor: onClick ? 'pointer' : 'default', minWidth: 0,
      }}
    >
      <div className="gw-pattern" style={{
        background: color, padding: compact ? '12px 14px' : '16px 16px',
        display: 'flex', alignItems: 'center', gap: 11, color: '#fff', minHeight: compact ? 0 : 66,
      }}>
        <div style={{
          width: compact ? 30 : 36, height: compact ? 30 : 36, borderRadius: 10,
          background: 'rgba(255,255,255,0.22)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: compact ? 14 : 16, fontWeight: 700, letterSpacing: -0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>}
        </div>
        {badge}
      </div>
      <div style={{ padding: compact ? '4px 14px' : '6px 16px', flex: 1 }}>
        {rows.map((r, i) => (
          <div key={r.label} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: compact ? '9px 0' : '11px 0',
            borderBottom: i < rows.length - 1 ? '1px solid var(--hairline)' : 'none',
          }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{r.label}</span>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', textAlign: 'right', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.value}</span>
          </div>
        ))}
      </div>
      {(action || link) && (
        <div onClick={(e) => e.stopPropagation()} style={{ padding: '4px 16px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, cursor: 'default' }}>
          {action && (
            <Button variant="block" size="sm" onClick={() => { action.onClick(); }}>
              {action.label}
            </Button>
          )}
          {link && (
            <button
              onClick={(e) => { e.stopPropagation(); link.onClick(); }}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}
            >{link.label}</button>
          )}
        </div>
      )}
    </div>
  );
}

/** White pill for use inside a GatewayCard header. */
export function HeaderPill({ children, dot }: { children: ReactNode; dot?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
      background: '#fff', color: 'var(--ink)', borderRadius: 999,
      padding: '3px 9px', fontSize: 11, fontWeight: 650,
    }}>
      {dot && <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: 6, background: dot }} />}
      {children}
    </span>
  );
}
