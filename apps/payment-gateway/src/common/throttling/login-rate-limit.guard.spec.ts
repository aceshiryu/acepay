import { ExecutionContext, HttpException } from '@nestjs/common';
import { LoginRateLimitGuard } from './login-rate-limit.guard';
import { InMemoryRateLimitStore } from './rate-limit.store';

function ctxFor(ip: string, email?: unknown): { ctx: ExecutionContext; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => { headers[k] = v; } };
  const req = { ip, socket: {}, body: email === undefined ? {} : { email } };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { ctx, headers };
}

/** Run n attempts, return how many were allowed. */
async function attempts(guard: LoginRateLimitGuard, n: number, ip: string, email?: string) {
  let allowed = 0;
  for (let i = 0; i < n; i++) {
    try { await guard.canActivate(ctxFor(ip, email).ctx); allowed++; } catch { /* throttled */ }
  }
  return allowed;
}

describe('LoginRateLimitGuard', () => {
  let guard: LoginRateLimitGuard;

  beforeEach(() => { guard = new LoginRateLimitGuard(new InMemoryRateLimitStore()); });

  it('lets a normal login through', async () => {
    await expect(guard.canActivate(ctxFor('1.1.1.1', 'admin@acepay.dev').ctx)).resolves.toBe(true);
  });

  // Email alone would let a botnet spread one account's attempts across many
  // addresses; IP alone would let one address work through many accounts.
  it('caps attempts against a single account at 10, even from many addresses', async () => {
    let allowed = 0;
    for (let i = 0; i < 20; i++) {
      try { await guard.canActivate(ctxFor(`10.0.0.${i}`, 'victim@acepay.dev').ctx); allowed++; } catch { /* throttled */ }
    }
    expect(allowed).toBe(10);
  });

  it('caps attempts from a single address at 20, even across many accounts', async () => {
    let allowed = 0;
    for (let i = 0; i < 30; i++) {
      try { await guard.canActivate(ctxFor('9.9.9.9', `user${i}@acepay.dev`).ctx); allowed++; } catch { /* throttled */ }
    }
    expect(allowed).toBe(20);
  });

  it('counts an address even when no email is supplied', async () => {
    expect(await attempts(guard, 25, '8.8.8.8')).toBe(20);
  });

  it('keeps separate counters per account', async () => {
    await attempts(guard, 10, '1.2.3.4', 'first@acepay.dev');
    await expect(guard.canActivate(ctxFor('5.6.7.8', 'second@acepay.dev').ctx)).resolves.toBe(true);
  });

  it('treats an email as the same account regardless of case or padding', async () => {
    await attempts(guard, 10, '1.1.1.1', 'admin@acepay.dev');
    await expect(guard.canActivate(ctxFor('2.2.2.2', '  ADMIN@AcePay.dev  ').ctx))
      .rejects.toBeInstanceOf(HttpException);
  });

  it('ignores a non-string email rather than throwing', async () => {
    await expect(guard.canActivate(ctxFor('3.3.3.3', { nested: 'object' }).ctx)).resolves.toBe(true);
  });

  describe('when throttled', () => {
    it('returns 429 with a Retry-After header', async () => {
      await attempts(guard, 10, '4.4.4.4', 'admin@acepay.dev');
      const { ctx, headers } = ctxFor('4.4.4.4', 'admin@acepay.dev');
      try {
        await guard.canActivate(ctx);
        throw new Error('expected a throw');
      } catch (e) {
        const err = e as HttpException;
        expect(err.getStatus()).toBe(429);
        expect((err.getResponse() as { error: string }).error).toBe('too_many_login_attempts');
        expect(headers['Retry-After']).toBeDefined();
      }
    });

    // The login response itself deliberately cannot distinguish a wrong password
    // from an unknown account; the throttle must not undo that.
    it('says nothing about whether the account exists', async () => {
      await attempts(guard, 10, '5.5.5.5', 'admin@acepay.dev');
      try {
        await guard.canActivate(ctxFor('5.5.5.5', 'admin@acepay.dev').ctx);
        throw new Error('expected a throw');
      } catch (e) {
        const body = (e as HttpException).getResponse() as { message: string };
        expect(body.message).toBe('Too many login attempts. Try again shortly.');
        expect(body.message).not.toMatch(/account|user|email|exist|password/i);
      }
    });
  });

  it('falls back to the socket address when req.ip is absent', async () => {
    const req = { ip: undefined, socket: { remoteAddress: '7.7.7.7' }, body: {} };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ setHeader: () => undefined }) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
