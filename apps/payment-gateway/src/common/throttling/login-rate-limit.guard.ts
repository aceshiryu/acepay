import {
  CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RATE_LIMIT_STORE } from './throttling.tokens';
import type { RateLimitStore } from './rate-limit.store';

/**
 * Slows down password guessing on POST /admin/auth/login.
 *
 * Every /v1 route is rate limited per app, but the admin login had no limit at
 * all: an attacker could try passwords as fast as the network allowed. scrypt
 * makes each attempt expensive, which is not the same as bounding how many
 * attempts are possible.
 *
 * Counted per client IP AND per submitted email, whichever trips first:
 * - IP alone lets an attacker rotate through accounts from one address.
 * - Email alone lets a botnet spread one account's attempts across many IPs,
 *   and also lets anyone lock out a known account by failing it deliberately.
 * Hitting the limit never says whether the account exists, matching the
 * deliberate ambiguity of the login response itself.
 */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly windowMs = 5 * 60_000;
  private readonly maxPerIp = 20;
  private readonly maxPerEmail = 10;

  constructor(@Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { body?: { email?: unknown } }>();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';

    const checks: Array<Promise<{ allowed: boolean; resetAt: number }>> = [
      this.store.hit(`login:ip:${ip}`, this.maxPerIp, this.windowMs),
    ];
    if (email) checks.push(this.store.hit(`login:email:${email}`, this.maxPerEmail, this.windowMs));

    const results = await Promise.all(checks);
    const blocked = results.find((r) => !r.allowed);
    if (!blocked) return true;

    const retryAfter = Math.max(1, Math.ceil((blocked.resetAt - Date.now()) / 1000));
    ctx.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(retryAfter));
    throw new HttpException(
      {
        error: 'too_many_login_attempts',
        // Deliberately says nothing about whether the account exists.
        message: 'Too many login attempts. Try again shortly.',
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
