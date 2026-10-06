/**
 * Human-readable record codes ("TXN-000123") shown in the admin instead of
 * UUIDs. The UUID stays the primary key and the API id; `code` is display-only.
 *
 * Each table owns a Postgres sequence `<table>_code_seq` and a column default
 * that formats `nextval` — so the code is assigned by the database on insert
 * (no app-side generation, no race), and TypeORM reads it back via RETURNING.
 * Migration 1747001200000-DisplayCodes creates the sequences and backfills.
 */
export const DISPLAY_CODE_PREFIX = {
  apps: 'APP',
  plans: 'PLN',
  customers: 'CUS',
  subscriptions: 'SUB',
  transactions: 'TXN',
  webhook_events: 'EVT',
  merchants: 'MER',
  payout_runs: 'RUN',
  payouts: 'PO',
} as const;

export type DisplayCodeTable = keyof typeof DISPLAY_CODE_PREFIX;

/** Digits are zero-padded to this width; larger numbers simply grow wider. */
export const DISPLAY_CODE_WIDTH = 6;

/** SQL expression used as the `code` column default for `table`. */
export function displayCodeSql(table: DisplayCodeTable): string {
  return `'${DISPLAY_CODE_PREFIX[table]}-' || lpad(nextval('${table}_code_seq')::text, ${DISPLAY_CODE_WIDTH}, '0')`;
}

/** Column options for an entity's `code` column. */
export function displayCodeColumn(table: DisplayCodeTable) {
  return {
    type: 'varchar' as const,
    length: 20,
    update: false,
    default: () => displayCodeSql(table),
  };
}
