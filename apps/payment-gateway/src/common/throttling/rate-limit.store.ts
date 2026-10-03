/**
 * Minimal fixed-window rate-limit store. Kept behind an interface so the guard
 * can use an in-process Map locally/in tests and (later) a Redis-backed store
 * across multiple gateway instances without changing the guard.
 */
export interface RateLimitHit {
  count: number;
  limit: number;
  remaining: number;
  resetAt: number; // epoch ms when the current window ends
  allowed: boolean;
}

export interface RateLimitStore {
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitHit>;
}

interface WindowState {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, WindowState>();

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitHit> {
    const now = Date.now();
    let state = this.windows.get(key);
    if (!state || now >= state.resetAt) {
      state = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, state);
    }
    state.count += 1;
    const remaining = Math.max(0, limit - state.count);
    return {
      count: state.count,
      limit,
      remaining,
      resetAt: state.resetAt,
      allowed: state.count <= limit,
    };
  }

  /** Drop expired windows — call periodically if used long-lived. */
  sweep(now = Date.now()): void {
    for (const [key, state] of this.windows) {
      if (now >= state.resetAt) this.windows.delete(key);
    }
  }

  reset(): void {
    this.windows.clear();
  }
}
