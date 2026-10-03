// The entity barrel has a circular import (App → Customer → Subscription →
// Plan → App) that swc-jest turns into a temporal-dead-zone error at load.
// This spec only needs App as a DI token, so stub the barrel out — same
// workaround as the worker's processor spec.
jest.mock('../database/entities', () => ({
  App: class App {},
  Customer: class Customer {},
  Plan: class Plan {},
  Subscription: class Subscription {},
  Transaction: class Transaction {},
  TransactionLog: class TransactionLog {},
  User: class User {},
  WebhookEvent: class WebhookEvent {},
}));

import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { App } from '../database/entities';
import { ApiKeyGuard, AuthedRequest } from './api-key.guard';
import { ApiKeyService } from './api-key.service';

function ctxFor(apiKey?: string): { ctx: ExecutionContext; req: AuthedRequest } {
  const req = {
    header: (name: string) => (name.toLowerCase() === 'x-api-key' ? apiKey : undefined),
  } as unknown as AuthedRequest;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function app(overrides: Partial<App> = {}): App {
  return { id: 'app-1', slug: 'savi', isActive: true, ...overrides } as App;
}

describe('ApiKeyGuard', () => {
  let apiKeys: { resolveByApiKey: jest.Mock };
  let guard: ApiKeyGuard;

  beforeEach(() => {
    apiKeys = { resolveByApiKey: jest.fn() };
    guard = new ApiKeyGuard(apiKeys as unknown as ApiKeyService);
  });

  describe('the x-api-key header', () => {
    it.each([
      ['absent', undefined],
      ['an empty string', ''],
    ])('rejects a request whose header is %s', async (_label, key) => {
      const { ctx } = ctxFor(key);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
      // No lookup at all — an empty key must never reach the database.
      expect(apiKeys.resolveByApiKey).not.toHaveBeenCalled();
    });

    it('says the header is required', async () => {
      try {
        await guard.canActivate(ctxFor(undefined).ctx);
        throw new Error('expected a throw');
      } catch (e) {
        expect((e as UnauthorizedException).getResponse()).toEqual({
          error: 'missing_api_key',
          message: 'x-api-key header is required',
        });
      }
    });

    it('passes the key through verbatim, without trimming', async () => {
      apiKeys.resolveByApiKey.mockResolvedValue(app());
      await guard.canActivate(ctxFor('  pk_live_savi_abc  ').ctx);
      expect(apiKeys.resolveByApiKey).toHaveBeenCalledWith('  pk_live_savi_abc  ');
    });
  });

  describe('an unrecognized key', () => {
    it('is a 401, not a 403 — we will not confirm the key exists', async () => {
      apiKeys.resolveByApiKey.mockResolvedValue(null);
      try {
        await guard.canActivate(ctxFor('pk_live_savi_nope').ctx);
        throw new Error('expected a throw');
      } catch (e) {
        expect(e).toBeInstanceOf(UnauthorizedException);
        expect((e as UnauthorizedException).getResponse()).toEqual({
          error: 'invalid_api_key',
          message: 'API key is not recognized',
        });
      }
    });

    it('leaves no app on the request', async () => {
      apiKeys.resolveByApiKey.mockResolvedValue(null);
      const { ctx, req } = ctxFor('pk_live_savi_nope');
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(req.acepayApp).toBeUndefined();
    });
  });

  describe('a deactivated app', () => {
    // A known-but-disabled app gets a distinguishable 403 naming the app, so an
    // operator can tell "your key is wrong" from "your app was switched off".
    it('is a 403 that names the app', async () => {
      apiKeys.resolveByApiKey.mockResolvedValue(app({ isActive: false }));
      try {
        await guard.canActivate(ctxFor('pk_live_savi_abc').ctx);
        throw new Error('expected a throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect((e as ForbiddenException).getResponse()).toEqual({
          error: 'app_inactive',
          message: 'App savi is deactivated',
        });
      }
    });

    it('does not attach the app to the request', async () => {
      apiKeys.resolveByApiKey.mockResolvedValue(app({ isActive: false }));
      const { ctx, req } = ctxFor('pk_live_savi_abc');
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
      expect(req.acepayApp).toBeUndefined();
    });
  });

  describe('a valid key on an active app', () => {
    it('allows the request', async () => {
      apiKeys.resolveByApiKey.mockResolvedValue(app());
      await expect(guard.canActivate(ctxFor('pk_live_savi_abc').ctx)).resolves.toBe(true);
    });

    // AppRateLimitGuard reads req.acepayApp, so this attachment is what makes
    // per-app rate limiting work at all.
    it('attaches the app for downstream guards and @CurrentApp()', async () => {
      const a = app();
      apiKeys.resolveByApiKey.mockResolvedValue(a);
      const { ctx, req } = ctxFor('pk_live_savi_abc');
      await guard.canActivate(ctx);
      expect(req.acepayApp).toBe(a);
    });
  });

  it('surfaces a lookup failure rather than silently denying access', async () => {
    apiKeys.resolveByApiKey.mockRejectedValue(new Error('connection terminated'));
    await expect(guard.canActivate(ctxFor('pk_live_savi_abc').ctx))
      .rejects.toThrow('connection terminated');
  });
});
