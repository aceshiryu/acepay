// The entity barrel has a circular import (App → Customer → Subscription →
// Plan → App) that swc-jest turns into a temporal-dead-zone error at load.
// These specs only need the classes as DI tokens, so stub the barrel out —
// same workaround as the worker's processor spec.
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

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { User } from '../database/entities';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard, AdminRequest } from './admin.guard';

function ctxFor(authorization?: string): { ctx: ExecutionContext; req: AdminRequest } {
  const req = {
    header: (name: string) =>
      (name.toLowerCase() === 'authorization' ? authorization : undefined),
  } as unknown as AdminRequest;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function activeUser(overrides: Partial<User> = {}): User {
  return { id: 'u-1', email: 'admin@acepay.dev', isActive: true, ...overrides } as User;
}

/** The error code inside the UnauthorizedException body. */
async function codeFor(guard: AdminGuard, ctx: ExecutionContext): Promise<string> {
  try {
    await guard.canActivate(ctx);
    throw new Error('expected canActivate to throw');
  } catch (e) {
    expect(e).toBeInstanceOf(UnauthorizedException);
    return ((e as UnauthorizedException).getResponse() as { error: string }).error;
  }
}

describe('AdminGuard', () => {
  let auth: { verifyToken: jest.Mock; getUser: jest.Mock };
  let guard: AdminGuard;

  beforeEach(() => {
    auth = { verifyToken: jest.fn(), getUser: jest.fn() };
    guard = new AdminGuard(auth as unknown as AdminAuthService);
  });

  describe('the Authorization header', () => {
    it.each([
      ['absent', undefined],
      ['empty', ''],
      ['a Basic credential', 'Basic YWRtaW46cA=='],
      ['a bare token with no scheme', 'eyJhbGciOiJIUzI1NiJ9.e30.sig'],
      ['the word Bearer with no space or token', 'Bearer'],
      ['a scheme that merely starts with bearer', 'Bearertoken'],
    ])('rejects a request whose header is %s', async (_label, header) => {
      expect(await codeFor(guard, ctxFor(header).ctx)).toBe('missing_token');
      expect(auth.verifyToken).not.toHaveBeenCalled();
    });

    it.each(['Bearer', 'bearer', 'BEARER', 'BeArEr'])(
      'accepts the %s scheme case-insensitively',
      async (scheme) => {
        auth.verifyToken.mockReturnValue({ sub: 'u-1' });
        auth.getUser.mockResolvedValue(activeUser());
        await expect(guard.canActivate(ctxFor(`${scheme} tok`).ctx)).resolves.toBe(true);
        expect(auth.verifyToken).toHaveBeenCalledWith('tok');
      },
    );

    it('trims surrounding whitespace off the token', async () => {
      auth.verifyToken.mockReturnValue({ sub: 'u-1' });
      auth.getUser.mockResolvedValue(activeUser());
      await guard.canActivate(ctxFor('Bearer    tok   ').ctx);
      expect(auth.verifyToken).toHaveBeenCalledWith('tok');
    });

    it('rejects "Bearer " with an empty token', async () => {
      auth.verifyToken.mockReturnValue(null);
      expect(await codeFor(guard, ctxFor('Bearer    ').ctx)).toBe('invalid_token');
    });
  });

  describe('the token itself', () => {
    it('rejects a token the auth service cannot verify', async () => {
      auth.verifyToken.mockReturnValue(null);
      expect(await codeFor(guard, ctxFor('Bearer bad.token.sig').ctx)).toBe('invalid_token');
      expect(auth.getUser).not.toHaveBeenCalled();
    });

    it('surfaces a verifier that throws instead of swallowing it', async () => {
      auth.verifyToken.mockImplementation(() => {
        throw new Error('ADMIN_JWT_SECRET env var is required');
      });
      await expect(guard.canActivate(ctxFor('Bearer tok').ctx)).rejects.toThrow(
        'ADMIN_JWT_SECRET env var is required',
      );
    });
  });

  describe('the user behind a valid token', () => {
    beforeEach(() => auth.verifyToken.mockReturnValue({ sub: 'u-1', email: 'a@b.c' }));

    it('rejects a token whose user row no longer exists (deleted admin)', async () => {
      auth.getUser.mockResolvedValue(null);
      expect(await codeFor(guard, ctxFor('Bearer tok').ctx)).toBe('user_inactive');
    });

    it('rejects a deactivated admin holding a still-valid token', async () => {
      auth.getUser.mockResolvedValue(activeUser({ isActive: false }));
      expect(await codeFor(guard, ctxFor('Bearer tok').ctx)).toBe('user_inactive');
    });

    it('looks the user up by the token subject', async () => {
      auth.getUser.mockResolvedValue(activeUser());
      await guard.canActivate(ctxFor('Bearer tok').ctx);
      expect(auth.getUser).toHaveBeenCalledWith('u-1');
    });

    it('attaches the resolved user to the request', async () => {
      const user = activeUser();
      auth.getUser.mockResolvedValue(user);
      const { ctx, req } = ctxFor('Bearer tok');
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.adminUser).toBe(user);
    });

    it('leaves no user on the request when authorization fails', async () => {
      auth.getUser.mockResolvedValue(activeUser({ isActive: false }));
      const { ctx, req } = ctxFor('Bearer tok');
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(req.adminUser).toBeUndefined();
    });
  });
});
