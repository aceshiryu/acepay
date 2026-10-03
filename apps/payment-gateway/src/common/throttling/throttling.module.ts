import { Global, Module } from '@nestjs/common';
import { AppRateLimitGuard } from './app-rate-limit.guard';
import { LoginRateLimitGuard } from './login-rate-limit.guard';
import { InMemoryRateLimitStore } from './rate-limit.store';
import { RATE_LIMIT_STORE } from './throttling.tokens';

/**
 * Provides the shared rate-limit store + the per-app guard. Global so any
 * app-facing controller can add `AppRateLimitGuard` to its @UseGuards list.
 *
 * The store is in-memory today (single App Engine instance handles the free
 * tier fine). Swap the provider for a Redis-backed store to share counters
 * across instances — the guard is unchanged.
 */
@Global()
@Module({
  providers: [
    { provide: RATE_LIMIT_STORE, useClass: InMemoryRateLimitStore },
    AppRateLimitGuard,
    LoginRateLimitGuard,
  ],
  exports: [RATE_LIMIT_STORE, AppRateLimitGuard, LoginRateLimitGuard],
})
export class ThrottlingModule {}
