import { PayoutRunStatus, PayoutStatus } from '../../common/enums';
import {
  canTransitionPayout, effectiveFeePercent, MarketplaceFeeNotSetError, mapWithConcurrency,
  maskAccount, payoutDestinationHash, settledRunStatus, splitAmount,
} from './marketplace.util';

describe('marketplace fee math', () => {
  const NOW = new Date('2026-10-04T00:00:00Z');

  describe('effectiveFeePercent', () => {
    it("uses the app's fee when the merchant has no override", () => {
      expect(effectiveFeePercent({ marketplaceFeePercent: 12 }, {}, NOW)).toBe(12);
    });

    it('uses a running override (e.g. the 10% founding-coach rate)', () => {
      expect(effectiveFeePercent(
        { marketplaceFeePercent: 12 },
        { feeOverridePercent: 10, feeOverrideEndsAt: new Date('2027-01-01T00:00:00Z') },
        NOW,
      )).toBe(10);
    });

    it('uses an override with no end date forever', () => {
      expect(effectiveFeePercent({ marketplaceFeePercent: 12 }, { feeOverridePercent: 10, feeOverrideEndsAt: null }, NOW)).toBe(10);
    });

    it("falls back to the app's fee once the override has ended", () => {
      expect(effectiveFeePercent(
        { marketplaceFeePercent: 12 },
        { feeOverridePercent: 10, feeOverrideEndsAt: new Date('2026-10-03T23:59:59Z') },
        NOW,
      )).toBe(12);
    });

    it('treats the exact end instant as ended', () => {
      expect(effectiveFeePercent(
        { marketplaceFeePercent: 12 },
        { feeOverridePercent: 10, feeOverrideEndsAt: NOW },
        NOW,
      )).toBe(12);
    });

    it('honours a 0% override (free for this merchant)', () => {
      expect(effectiveFeePercent({ marketplaceFeePercent: 12 }, { feeOverridePercent: 0 }, NOW)).toBe(0);
    });

    it('throws when the app has no fee — there is no global default', () => {
      expect(() => effectiveFeePercent({ marketplaceFeePercent: null }, {}, NOW)).toThrow(MarketplaceFeeNotSetError);
    });

    it('still uses a running override when the app has no fee', () => {
      expect(effectiveFeePercent({ marketplaceFeePercent: null }, { feeOverridePercent: 10 }, NOW)).toBe(10);
    });
  });

  describe('splitAmount', () => {
    it.each([
      // [amount, percent, platformFee, merchantAmount]
      [50000, 12, 6000, 44000],     // ₱500 BooklyPH booking
      [50000, 10, 5000, 45000],     // founding-coach rate
      [50000, 0, 0, 50000],
      [50000, 100, 50000, 0],
      [33333, 12, 4000, 29333],     // 3999.96 rounds up
      [33333, 12.5, 4167, 29166],   // 4166.625 rounds up
      [101, 12, 12, 89],            // 12.12 rounds down
      [125, 12, 15, 110],           // exactly 15
      [1, 50, 1, 0],                // half a centavo rounds up
      [999999, 7.25, 72500, 927499], // 72499.93
    ])('%i at %s%% → fee %i, merchant %i', (amount, percent, fee, merchant) => {
      const r = splitAmount(amount, percent);
      expect(r).toEqual({ platformFee: fee, merchantAmount: merchant });
      expect(r.platformFee + r.merchantAmount).toBe(amount);
    });

    it('never produces a float', () => {
      for (let a = 1; a < 2000; a += 37) {
        const r = splitAmount(a, 12.34);
        expect(Number.isInteger(r.platformFee)).toBe(true);
        expect(Number.isInteger(r.merchantAmount)).toBe(true);
      }
    });

    it.each([0, -100, 12.5, NaN])('rejects a non-positive / non-integer amount (%s)', (amount) => {
      expect(() => splitAmount(amount, 12)).toThrow();
    });

    it.each([-1, 100.01, NaN])('rejects an out-of-range percent (%s)', (pct) => {
      expect(() => splitAmount(50000, pct)).toThrow();
    });
  });
});

describe('payoutDestinationHash', () => {
  it('ignores spaces, dashes and channel case', () => {
    expect(payoutDestinationHash('ph_gcash', '0917-123 4567')).toBe(payoutDestinationHash('PH_GCASH', '09171234567'));
  });

  it('differs by channel', () => {
    expect(payoutDestinationHash('PH_GCASH', '09171234567')).not.toBe(payoutDestinationHash('PH_PAYMAYA', '09171234567'));
  });

  it('is a sha256 hex digest', () => {
    expect(payoutDestinationHash('PH_BPI', '1234')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('canTransitionPayout', () => {
  const S = PayoutStatus;
  it.each([
    [S.Draft, S.Queued, true],
    [S.Queued, S.Pending, true],
    [S.Queued, S.Succeeded, true],
    [S.Pending, S.Succeeded, true],
    [S.Pending, S.Failed, true],
    [S.Succeeded, S.Reversed, true],   // bank bounce-back
    [S.Succeeded, S.Pending, false],   // late REQUESTED callback after success
    [S.Succeeded, S.Failed, false],
    [S.Failed, S.Succeeded, false],
    [S.Failed, S.Pending, false],
    [S.Reversed, S.Succeeded, false],
    [S.Skipped, S.Queued, false],
    [S.Pending, S.Pending, false],     // a repeat is not a change
  ])('%s → %s = %s', (from, to, ok) => {
    expect(canTransitionPayout(from, to)).toBe(ok);
  });
});

describe('settledRunStatus', () => {
  const S = PayoutStatus;
  it('is null while anything is in flight', () => {
    expect(settledRunStatus([S.Succeeded, S.Pending])).toBeNull();
    expect(settledRunStatus([S.Succeeded, S.Queued])).toBeNull();
  });
  it('is completed when everything succeeded', () => {
    expect(settledRunStatus([S.Succeeded, S.Succeeded])).toBe(PayoutRunStatus.Completed);
  });
  it('is completed for an empty run', () => {
    expect(settledRunStatus([])).toBe(PayoutRunStatus.Completed);
  });
  it.each([S.Failed, S.Reversed, S.Canceled])('is completed_with_failures if any is %s', (bad) => {
    expect(settledRunStatus([S.Succeeded, bad])).toBe(PayoutRunStatus.CompletedWithFailures);
  });
});

describe('mapWithConcurrency', () => {
  it('keeps order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5 * (8 - n)));
      inFlight -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 5, async (x) => x)).toEqual([]);
  });
});

describe('maskAccount', () => {
  it('shows only the last 4', () => {
    expect(maskAccount('09171234567')).toBe('•••• 4567');
  });
  it('passes through empty', () => {
    expect(maskAccount(null)).toBeNull();
  });
});
