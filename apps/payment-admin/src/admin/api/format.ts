import { CurrencyAmount } from './types';

export function formatAmount(amount: number, currency: string): string {
  // amounts are in smallest currency unit (e.g. centavos / cents)
  const major = amount / 100;
  const symbol = currency === 'PHP' ? '₱'
    : currency === 'USD' ? '$'
    : `${currency} `;
  const sign = major < 0 ? '−' : '';
  const abs = Math.abs(major);
  const formatted = abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${symbol}${formatted}`;
}

export function formatAmountCompact(amount: number, currency: string): string {
  const major = amount / 100;
  const symbol = currency === 'PHP' ? '₱' : currency === 'USD' ? '$' : `${currency} `;
  const abs = Math.abs(major);
  let body: string;
  if (abs >= 1_000_000) body = (abs / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  else if (abs >= 1_000) body = (abs / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  else body = abs.toLocaleString();
  return `${symbol}${body}`;
}

export function pickPrimary(items: CurrencyAmount[]): CurrencyAmount | null {
  if (items.length === 0) return null;
  // Prefer PHP if present, otherwise the largest by amount.
  const php = items.find((i) => i.currency === 'PHP');
  if (php) return php;
  return items.slice().sort((a, b) => b.amount - a.amount)[0];
}

export function formatCurrencyList(items: CurrencyAmount[]): string {
  if (items.length === 0) return '—';
  return items.map((i) => formatAmount(i.amount, i.currency)).join(' · ');
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} hr ago`;
  return `${Math.round(ms / 86_400_000)} d ago`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

export function actionIcon(action: string): string {
  if (action.endsWith('.created')) return '+';
  if (action.endsWith('.succeeded')) return '✓';
  if (action.endsWith('.failed')) return '⚠';
  if (action.endsWith('.refunded') || action.endsWith('.renewed') || action.endsWith('.activated')) return '↻';
  if (action.endsWith('.app_notified')) return '✓';
  if (action.endsWith('.provider_sent')) return '↑';
  if (action.endsWith('.webhook_received')) return '↓';
  if (action.endsWith('.exhausted') || action.endsWith('.app_notify_failed')) return '☠';
  if (action.endsWith('.app_notify_retry') || action.endsWith('.past_due')) return '⚠';
  if (action.endsWith('.canceled') || action.endsWith('.expired') || action.endsWith('.paused')) return '↻';
  return '•';
}
