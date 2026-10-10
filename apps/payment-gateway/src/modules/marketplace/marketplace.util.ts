import { sha256 } from '../../common/crypto';
import { PayoutRunStatus, PayoutStatus } from '../../common/enums';

/** Thrown when a marketplace app has no fee configured. There is deliberately
 *  no global default — every app sets its own (BooklyPH: 12%). */
export class MarketplaceFeeNotSetError extends Error {
  constructor() {
    super('This app has no marketplace fee configured');
  }
}

/**
 * The fee that applies to a merchant right now: its override while that is
 * still running (e.g. a 10% founding-coach rate until a date), otherwise the
 * app's fee.
 */
export function effectiveFeePercent(
  app: { marketplaceFeePercent?: number | null },
  merchant: { feeOverridePercent?: number | null; feeOverrideEndsAt?: Date | null },
  now: Date = new Date(),
): number {
  const override = merchant.feeOverridePercent;
  if (override != null) {
    const endsAt = merchant.feeOverrideEndsAt ? new Date(merchant.feeOverrideEndsAt) : null;
    if (!endsAt || endsAt.getTime() > now.getTime()) return Number(override);
  }
  if (app.marketplaceFeePercent == null) throw new MarketplaceFeeNotSetError();
  return Number(app.marketplaceFeePercent);
}

/**
 * Splits a payment (minor units) into the platform's fee and the merchant's
 * share, before Xendit's own fees. Integer math in basis points so 12.5% of
 * ₱333.33 never drifts through floating point; half-centavos round up.
 *   ₱500 at 12% → fee 6000, merchant 44000.
 */
export function splitAmount(amount: number, percent: number): { platformFee: number; merchantAmount: number } {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('amount must be a positive integer (minor units)');
  if (!(percent >= 0 && percent <= 100)) throw new Error('fee percent must be between 0 and 100');
  const bp = Math.round(percent * 100);
  const platformFee = Math.min(amount, Math.floor((amount * bp + 5000) / 10000));
  return { platformFee, merchantAmount: amount - platformFee };
}

/** Fingerprint of a payout destination, so the same GCash / bank account can be
 *  spotted on several merchants without comparing raw account numbers. */
export function payoutDestinationHash(channelCode: string, accountNumber: string): string {
  const normalized = `${channelCode.trim().toUpperCase()}|${accountNumber.replace(/[\s-]/g, '')}`;
  return sha256(normalized);
}

const TERMINAL: PayoutStatus[] = [
  PayoutStatus.Succeeded, PayoutStatus.Failed, PayoutStatus.Canceled,
  PayoutStatus.Reversed, PayoutStatus.Skipped,
];

/**
 * Whether a provider update may move a payout from `from` to `to`. Xendit
 * callbacks can arrive out of order or twice: a terminal payout never goes
 * back to pending, and the only move out of `succeeded` is a bank bounce-back
 * (`reversed`).
 */
export function canTransitionPayout(from: PayoutStatus, to: PayoutStatus): boolean {
  if (from === to) return false;
  if (from === PayoutStatus.Succeeded) return to === PayoutStatus.Reversed;
  if (TERMINAL.includes(from)) return false;
  return true;
}

/** Run status once every payout is settled; null while any is still in flight. */
export function settledRunStatus(statuses: PayoutStatus[]): PayoutRunStatus | null {
  const inFlight = statuses.some((s) =>
    s === PayoutStatus.Queued || s === PayoutStatus.Pending || s === PayoutStatus.Draft);
  if (inFlight) return null;
  const bad = statuses.some((s) =>
    s === PayoutStatus.Failed || s === PayoutStatus.Canceled || s === PayoutStatus.Reversed);
  return bad ? PayoutRunStatus.CompletedWithFailures : PayoutRunStatus.Completed;
}

/** Runs a mapper over items with at most `limit` in flight — keeps balance
 *  reads for 1,000 merchants inside Xendit's rate limits. */
export async function mapWithConcurrency<T, R>(
  items: T[], limit: number, fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Masks all but the last 4 characters of an account number for display. */
export function maskAccount(accountNumber: string | null | undefined): string | null {
  if (!accountNumber) return null;
  const last4 = accountNumber.slice(-4);
  return `•••• ${last4}`;
}

/** Readable message from a provider/SDK error, capped for storage. */
export function errorMessage(err: unknown): string {
  const e = err as { errorMessage?: string; message?: string };
  return String(e?.errorMessage ?? e?.message ?? err).slice(0, 500);
}
