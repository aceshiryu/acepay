import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthedRequest } from '../../auth/api-key.guard';
import { RATE_LIMIT_STORE } from './throttling.tokens';
import type { RateLimitStore } from './rate-limit.store';

/**
 * Enforces the per-app request ceiling stored on `apps.rate_limit` (requests
 * per minute). Must run AFTER ApiKeyGuard so `req.acepayApp` is populated:
 *
 *   @UseGuards(ApiKeyGuard, AppRateLimitGuard)
 *
 * If no app is attached (route isn't app-authenticated), the guard is a no-op.
 */
@Injectable()
export class AppRateLimitGuard implements CanActivate {
  private readonly windowMs = 60_000;

  constructor(@Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const app = req.acepayApp;
    if (!app) return true; // not an app-authenticated route

    const limit = app.rateLimit && app.rateLimit > 0 ? app.rateLimit : 100;
    const result = await this.store.hit(`app:${app.id}`, limit, this.windowMs);

    const res = ctx.switchToHttp().getResponse<Response>();
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      throw new HttpException(
        {
          error: 'rate_limited',
          message: `Rate limit of ${limit} requests/min exceeded for app ${app.slug}`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
