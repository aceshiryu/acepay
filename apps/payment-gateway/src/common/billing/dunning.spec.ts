import {
  MS_PER_DAY,
  RETRY_SCHEDULE_DAYS,
  onChargeFailed,
  onChargeSucceeded,
  readDunning,
} from './dunning';

describe('dunning policy', () => {
  describe('readDunning', () => {
    it('defaults to zero attempts for empty/absent metadata', () => {
      expect(readDunning(undefined).attempts).toBe(0);
      expect(readDunning({}).attempts).toBe(0);
      expect(readDunning({ dunning: {} }).attempts).toBe(0);
    });

    it('reads an existing attempt count', () => {
      expect(readDunning({ dunning: { attempts: 2 } }).attempts).toBe(2);
    });

    it('ignores a malformed attempts value', () => {
      expect(readDunning({ dunning: { attempts: -5 } }).attempts).toBe(0);
      expect(readDunning({ dunning: { attempts: 'nope' } }).attempts).toBe(0);
    });
  });

  describe('onChargeFailed', () => {
    const now = new Date('2026-01-01T00:00:00Z');

    it('schedules the first retry after the first failure', () => {
      const d = onChargeFailed({ attempts: 0 }, now);
      expect(d.attempt).toBe(1);
      expect(d.shouldRetry).toBe(true);
      expect(d.exhausted).toBe(false);
      expect(d.retryDelayMs).toBe(RETRY_SCHEDULE_DAYS[0] * MS_PER_DAY);
      expect(d.nextState.attempts).toBe(1);
      expect(d.nextState.firstFailedAt).toBe(now.toISOString());
    });

    it('escalates the delay on the second failure', () => {
      const d = onChargeFailed({ attempts: 1, firstFailedAt: '2025-12-30T00:00:00Z' }, now);
      expect(d.attempt).toBe(2);
      expect(d.shouldRetry).toBe(true);
      expect(d.retryDelayMs).toBe(RETRY_SCHEDULE_DAYS[1] * MS_PER_DAY);
      // preserves the original firstFailedAt
      expect(d.nextState.firstFailedAt).toBe('2025-12-30T00:00:00Z');
    });

    it('exhausts retries after the schedule is used up', () => {
      const d = onChargeFailed({ attempts: RETRY_SCHEDULE_DAYS.length }, now);
      expect(d.shouldRetry).toBe(false);
      expect(d.exhausted).toBe(true);
      expect(d.retryDelayMs).toBe(0);
    });

    it('always records lastFailedAt', () => {
      const d = onChargeFailed({ attempts: 0 }, now);
      expect(d.nextState.lastFailedAt).toBe(now.toISOString());
    });
  });

  describe('onChargeSucceeded', () => {
    it('reports recovery when there were prior failures and clears the streak', () => {
      const r = onChargeSucceeded({ attempts: 2 });
      expect(r.recovered).toBe(true);
      expect(r.nextState.attempts).toBe(0);
    });

    it('is not a recovery when there were no prior failures', () => {
      expect(onChargeSucceeded({ attempts: 0 }).recovered).toBe(false);
    });
  });

  describe('the documented 1d/3d/5d policy', () => {
    const now = new Date('2026-01-01T00:00:00Z');

    it('uses every slot in the schedule, in order', () => {
      const delays: number[] = [];
      let state: import('./dunning').DunningState = { attempts: 0 };
      let guard = 0;
      for (;;) {
        const d = onChargeFailed(state, now);
        state = d.nextState;
        if (d.exhausted) break;
        delays.push(d.retryDelayMs / MS_PER_DAY);
        if (++guard > 10) throw new Error('dunning never exhausted');
      }
      // Every configured wait is used exactly once, first to last — the 1-day
      // slot must not be skipped.
      expect(delays).toEqual([...RETRY_SCHEDULE_DAYS]);
    });

    it('gives one retry per schedule entry before giving up', () => {
      let state: import('./dunning').DunningState = { attempts: 0 };
      const retries: number[] = [];
      for (let i = 0; i < RETRY_SCHEDULE_DAYS.length; i++) {
        const d = onChargeFailed(state, now);
        expect(d.shouldRetry).toBe(true);
        expect(d.exhausted).toBe(false);
        retries.push(d.attempt);
        state = d.nextState;
      }
      expect(retries).toEqual([1, 2, 3]);
      // Only the failure after the last slot exhausts the policy.
      const final = onChargeFailed(state, now);
      expect(final.attempt).toBe(RETRY_SCHEDULE_DAYS.length + 1);
      expect(final.exhausted).toBe(true);
      expect(final.shouldRetry).toBe(false);
      expect(final.retryDelayMs).toBe(0);
    });

    it('stays exhausted for any attempt count beyond the schedule', () => {
      for (const attempts of [RETRY_SCHEDULE_DAYS.length, 5, 99]) {
        const d = onChargeFailed({ attempts }, now);
        expect(d.exhausted).toBe(true);
        expect(d.retryDelayMs).toBe(0);
      }
    });

    it('keeps the subscription retrying (not past_due) while a slot remains', () => {
      // The grace window is exactly the non-exhausted attempts — this is what
      // keeps a customer Active while their card is retried.
      const first = onChargeFailed({ attempts: 0 }, now);
      expect(first.exhausted).toBe(false);
      expect(first.retryDelayMs).toBe(1 * MS_PER_DAY);
    });
  });

  describe('state carried across failures', () => {
    const now = new Date('2026-03-10T08:30:00Z');

    it('preserves the original firstFailedAt across the whole streak', () => {
      const first = onChargeFailed({ attempts: 0 }, new Date('2026-03-01T00:00:00Z'));
      const second = onChargeFailed(first.nextState, now);
      const third = onChargeFailed(second.nextState, now);
      expect(third.nextState.firstFailedAt).toBe('2026-03-01T00:00:00.000Z');
      expect(third.nextState.lastFailedAt).toBe(now.toISOString());
    });

    it('starts a fresh streak after a success clears the state', () => {
      const failed = onChargeFailed({ attempts: 2, firstFailedAt: '2026-01-01T00:00:00Z' }, now);
      const cleared = onChargeSucceeded(failed.nextState).nextState;
      expect(cleared.attempts).toBe(0);
      // A later failure is attempt 1 again, back to the 1-day wait.
      const next = onChargeFailed(cleared, now);
      expect(next.attempt).toBe(1);
      expect(next.retryDelayMs).toBe(RETRY_SCHEDULE_DAYS[0] * MS_PER_DAY);
      expect(next.nextState.firstFailedAt).toBe(now.toISOString());
    });

    it('does not mutate the state it was given', () => {
      const prev = { attempts: 1, firstFailedAt: '2026-01-01T00:00:00Z' };
      onChargeFailed(prev, now);
      expect(prev).toEqual({ attempts: 1, firstFailedAt: '2026-01-01T00:00:00Z' });
    });

    it('round-trips through a metadata bag the way the processor uses it', () => {
      const metadata: Record<string, unknown> = {};
      let decision = onChargeFailed(readDunning(metadata), now);
      metadata.dunning = decision.nextState;
      decision = onChargeFailed(readDunning(metadata), now);
      expect(decision.attempt).toBe(2);
      expect(decision.retryDelayMs).toBe(RETRY_SCHEDULE_DAYS[1] * MS_PER_DAY);
    });
  });

  describe('readDunning hardening', () => {
    it.each([
      ['a non-object dunning value', { dunning: 'nope' }],
      ['a null dunning value', { dunning: null }],
      ['a numeric dunning value', { dunning: 7 }],
      ['null metadata', null],
    ])('defaults cleanly for %s', (_label, metadata) => {
      expect(readDunning(metadata as Record<string, unknown> | null)).toEqual({
        attempts: 0,
        firstFailedAt: undefined,
        lastFailedAt: undefined,
      });
    });

    it.each([
      ['a fractional attempt count', 1.5, 1.5],
      ['zero', 0, 0],
    ])('passes through %s', (_label, input, expected) => {
      expect(readDunning({ dunning: { attempts: input } }).attempts).toBe(expected);
    });

    it.each([NaN, Infinity, -Infinity])('rejects %p as an attempt count', (value) => {
      // All three are typeof 'number', so the guard has to check finiteness too.
      // An Infinity that slipped through would also not survive JSON round-trip
      // into metadata (it serializes to null), silently resetting the streak.
      expect(readDunning({ dunning: { attempts: value } }).attempts).toBe(0);
    });

    it('ignores non-string timestamps', () => {
      const s = readDunning({ dunning: { attempts: 1, firstFailedAt: 12345, lastFailedAt: {} } });
      expect(s.firstFailedAt).toBeUndefined();
      expect(s.lastFailedAt).toBeUndefined();
    });
  });
});
