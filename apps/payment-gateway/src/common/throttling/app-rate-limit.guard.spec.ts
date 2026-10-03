import { ExecutionContext, HttpException } from '@nestjs/common';
import { AppRateLimitGuard } from './app-rate-limit.guard';
import { InMemoryRateLimitStore } from './rate-limit.store';

function ctxFor(app: unknown): { ctx: ExecutionContext; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => { headers[k] = v; } };
  const req = { acepayApp: app };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { ctx, headers };
}

describe('InMemoryRateLimitStore', () => {
  it('counts hits within a window and flips allowed off past the limit', async () => {
    const store = new InMemoryRateLimitStore();
    const a = await store.hit('k', 2, 60_000);
    expect(a).toMatchObject({ count: 1, remaining: 1, allowed: true });
    const b = await store.hit('k', 2, 60_000);
    expect(b).toMatchObject({ count: 2, remaining: 0, allowed: true });
    const c = await store.hit('k', 2, 60_000);
    expect(c).toMatchObject({ count: 3, remaining: 0, allowed: false });
  });

  it('resets the count once the window elapses', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const store = new InMemoryRateLimitStore();
    await store.hit('k', 1, 1000);
    expect((await store.hit('k', 1, 1000)).allowed).toBe(false);
    jest.advanceTimersByTime(1001);
    expect((await store.hit('k', 1, 1000)).allowed).toBe(true);
    jest.useRealTimers();
  });

  it('keeps separate counters per key', async () => {
    const store = new InMemoryRateLimitStore();
    await store.hit('app:1', 1, 60_000);
    const other = await store.hit('app:2', 1, 60_000);
    expect(other.allowed).toBe(true);
  });
});

describe('AppRateLimitGuard', () => {
  let store: InMemoryRateLimitStore;
  let guard: AppRateLimitGuard;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
    guard = new AppRateLimitGuard(store);
  });

  it('is a no-op when no app is attached (non-app route)', async () => {
    const { ctx } = ctxFor(undefined);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows requests up to the app limit then throws 429', async () => {
    const app = { id: 'app-1', slug: 'savi', rateLimit: 2 };
    for (let i = 0; i < 2; i++) {
      await expect(guard.canActivate(ctxFor(app).ctx)).resolves.toBe(true);
    }
    await expect(guard.canActivate(ctxFor(app).ctx)).rejects.toBeInstanceOf(HttpException);
  });

  it('throws a 429 with a Retry-After header and rate_limited code', async () => {
    const app = { id: 'app-x', slug: 'vehikol', rateLimit: 1 };
    await guard.canActivate(ctxFor(app).ctx);
    const { ctx, headers } = ctxFor(app);
    try {
      await guard.canActivate(ctx);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as HttpException;
      expect(err.getStatus()).toBe(429);
      expect((err.getResponse() as { error: string }).error).toBe('rate_limited');
      expect(headers['Retry-After']).toBeDefined();
    }
  });

  it('sets informational X-RateLimit headers on an allowed request', async () => {
    const app = { id: 'app-2', slug: 'savi', rateLimit: 5 };
    const { ctx, headers } = ctxFor(app);
    await guard.canActivate(ctx);
    expect(headers['X-RateLimit-Limit']).toBe('5');
    expect(headers['X-RateLimit-Remaining']).toBe('4');
    expect(headers['X-RateLimit-Reset']).toBeDefined();
  });

  it('falls back to a default ceiling of 100 when rateLimit is unset', async () => {
    const app = { id: 'app-3', slug: 'savi', rateLimit: 0 };
    const { ctx, headers } = ctxFor(app);
    await guard.canActivate(ctx);
    expect(headers['X-RateLimit-Limit']).toBe('100');
  });

  it('keeps separate ceilings per app', async () => {
    const appA = { id: 'a', slug: 'a', rateLimit: 1 };
    const appB = { id: 'b', slug: 'b', rateLimit: 1 };
    await guard.canActivate(ctxFor(appA).ctx);
    // appB is independent — first hit still allowed.
    await expect(guard.canActivate(ctxFor(appB).ctx)).resolves.toBe(true);
  });
});
