import { TransactionStatus } from '../enums';

export interface CurrencyAmount {
  currency: string;
  amount: number;
}

export interface RevenueRow {
  currency: string;
  status: TransactionStatus;
  amount: number | string;
}

/**
 * Net revenue per currency: succeeded charges MINUS refunds, grouped by
 * currency and NEVER summed across currencies (PHP and USD stay separate).
 *
 * Refunds must reduce revenue, not inflate it — the naive "SUM where status IN
 * (succeeded, refunded)" adds them, which is the bug this fixes.
 */
export function netRevenueByCurrency(rows: RevenueRow[]): CurrencyAmount[] {
  const byCurrency = new Map<string, number>();
  for (const row of rows) {
    const amount = Number(row.amount) || 0;
    const cur = (row.currency || '').toUpperCase();
    if (!cur) continue;
    const signed =
      row.status === TransactionStatus.Refunded ? -amount :
      row.status === TransactionStatus.Succeeded ? amount :
      0; // pending/failed/canceled don't count toward revenue
    byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + signed);
  }
  return [...byCurrency.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Gross succeeded volume per currency (no refund subtraction). */
export function grossRevenueByCurrency(rows: RevenueRow[]): CurrencyAmount[] {
  return netRevenueByCurrency(rows.filter((r) => r.status === TransactionStatus.Succeeded));
}

/** Human display like "PHP 1,299.00 + USD 49.00" — makes it explicit that the
 *  figure is multi-currency and never a single mixed number. Amounts are in the
 *  currency's minor unit (centavos/cents) and shown in major units. */
export function formatCurrencyTotals(totals: CurrencyAmount[]): string {
  if (totals.length === 0) return '0';
  return totals
    .map((t) => `${t.currency} ${(t.amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    .join(' + ');
}
