/**
 * Dunning (smart-retry) policy for failed recurring charges.
 *
 * Instead of dropping a subscription straight to past_due on the first failed
 * charge, we retry on an escalating schedule and only give up ("exhausted")
 * after the last attempt. State is small and lives in Subscription.metadata.dunning
 * so no schema migration is needed.
 */

/** Days to wait before each retry after a failure. length = max retries. */
export const RETRY_SCHEDULE_DAYS = [1, 3, 5] as const;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DunningState {
  /** How many consecutive failed charges have occurred. */
  attempts: number;
  /** ISO timestamp of the first failure in the current streak. */
  firstFailedAt?: string;
  /** ISO timestamp of the most recent failure. */
  lastFailedAt?: string;
}

export interface DunningDecision {
  /** The attempt number that just failed (1-based). */
  attempt: number;
  /** Whether we should schedule another retry. */
  shouldRetry: boolean;
  /** Delay in ms before the retry (0 when exhausted). */
  retryDelayMs: number;
  /** True when there are no attempts left — the sub should go past_due. */
  exhausted: boolean;
  /** The state to persist back onto the subscription. */
  nextState: DunningState;
}

/** Read dunning state out of an arbitrary metadata bag, defaulting cleanly. */
export function readDunning(metadata: Record<string, unknown> | null | undefined): DunningState {
  const raw = (metadata?.dunning ?? {}) as Partial<DunningState>;
  return {
    attempts: typeof raw.attempts === 'number' && Number.isFinite(raw.attempts) && raw.attempts >= 0
      ? raw.attempts
      : 0,
    firstFailedAt: typeof raw.firstFailedAt === 'string' ? raw.firstFailedAt : undefined,
    lastFailedAt: typeof raw.lastFailedAt === 'string' ? raw.lastFailedAt : undefined,
  };
}

/**
 * Decide what to do after a charge FAILS, given the prior state.
 * `now` is injectable for deterministic tests.
 */
export function onChargeFailed(prev: DunningState, now: Date = new Date()): DunningDecision {
  const attempt = prev.attempts + 1; // this failure is attempt N
  const nextState: DunningState = {
    attempts: attempt,
    firstFailedAt: prev.firstFailedAt ?? now.toISOString(),
    lastFailedAt: now.toISOString(),
  };
  // The Nth failure consumes the Nth retry slot, so failure 1 waits
  // RETRY_SCHEDULE_DAYS[0] (1 day), failure 2 waits [1] (3 days), failure 3
  // waits [2] (5 days), and failure 4 has no slot left -> exhausted. Indexing
  // by `attempt` instead of `attempt - 1` skipped the 1-day slot entirely and
  // gave customers one fewer retry than the documented 1d/3d/5d policy.
  const idx = attempt - 1;
  const hasSlot = idx < RETRY_SCHEDULE_DAYS.length;
  if (hasSlot) {
    return {
      attempt,
      shouldRetry: true,
      retryDelayMs: RETRY_SCHEDULE_DAYS[idx] * MS_PER_DAY,
      exhausted: false,
      nextState,
    };
  }
  return {
    attempt,
    shouldRetry: false,
    retryDelayMs: 0,
    exhausted: true,
    nextState,
  };
}

/** After a SUCCESSFUL charge, clear any dunning streak. Returns whether the
 *  sub was recovering (had prior failures) so the caller can emit a
 *  `payment_recovered` event instead of a plain `payment_succeeded`. */
export function onChargeSucceeded(prev: DunningState): { recovered: boolean; nextState: DunningState } {
  return {
    recovered: prev.attempts > 0,
    nextState: { attempts: 0 },
  };
}
