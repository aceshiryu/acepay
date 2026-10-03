// The entity barrel has a circular import (App → Customer → Subscription →
// Plan → App) that swc-jest turns into a temporal-dead-zone error at load.
// This spec only needs User as a DI token, so stub the barrel out — same
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

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { hashPassword } from '../common/crypto';
import { User } from '../database/entities';
import { AdminAuthService } from './admin-auth.service';

const SECRET = 'test-admin-jwt-secret';
const PASSWORD = 'correct-horse-battery-staple';

/** iat/exp out of a signed token, without trusting the service to report them. */
function claims(token: string): { iat: number; exp: number; sub: string; email: string } {
  const body = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
}

describe('AdminAuthService', () => {
  let users: { findOne: jest.Mock; save: jest.Mock };
  let env: Record<string, string | undefined>;
  let service: AdminAuthService;
  let storedHash: string;

  beforeAll(async () => {
    storedHash = await hashPassword(PASSWORD);
  });

  function user(overrides: Partial<User> = {}): User {
    return {
      id: 'u-1',
      email: 'admin@acepay.dev',
      passwordHash: storedHash,
      isActive: true,
      ...overrides,
    } as User;
  }

  beforeEach(() => {
    users = { findOne: jest.fn(), save: jest.fn((u) => Promise.resolve(u)) };
    env = { ADMIN_JWT_SECRET: SECRET };
    const config = { get: (k: string) => env[k] } as unknown as ConfigService;
    service = new AdminAuthService(users as unknown as Repository<User>, config);
  });

  describe('login', () => {
    it('returns a token and the user for correct credentials', async () => {
      users.findOne.mockResolvedValue(user());
      const result = await service.login('admin@acepay.dev', PASSWORD);
      expect(result.token.split('.')).toHaveLength(3);
      expect(result.user.id).toBe('u-1');
    });

    it.each([
      ['ADMIN@ACEPAY.DEV', 'admin@acepay.dev'],
      ['Admin@AcePay.Dev', 'admin@acepay.dev'],
      ['admin@acepay.dev', 'admin@acepay.dev'],
    ])('looks %s up as %s (emails are case-insensitive)', async (input, expected) => {
      users.findOne.mockResolvedValue(user());
      await service.login(input, PASSWORD);
      expect(users.findOne).toHaveBeenCalledWith({ where: { email: expected } });
    });

    it('stamps lastLoginAt and persists it on success', async () => {
      const u = user();
      users.findOne.mockResolvedValue(u);
      await service.login(u.email, PASSWORD);
      expect(u.lastLoginAt).toBeInstanceOf(Date);
      expect(users.save).toHaveBeenCalledWith(u);
    });

    describe('rejection', () => {
      /** Every failure must look identical so the endpoint can't be used to
       *  enumerate which admin emails exist. */
      async function failureBody(email: string, password: string) {
        try {
          await service.login(email, password);
          throw new Error('expected login to throw');
        } catch (e) {
          expect(e).toBeInstanceOf(UnauthorizedException);
          return (e as UnauthorizedException).getResponse();
        }
      }

      const expected = {
        error: 'invalid_credentials',
        message: 'Email or password is incorrect',
      };

      it('rejects an unknown email', async () => {
        users.findOne.mockResolvedValue(null);
        expect(await failureBody('nobody@acepay.dev', PASSWORD)).toEqual(expected);
      });

      it('rejects a deactivated admin', async () => {
        users.findOne.mockResolvedValue(user({ isActive: false }));
        expect(await failureBody('admin@acepay.dev', PASSWORD)).toEqual(expected);
      });

      it('rejects a wrong password', async () => {
        users.findOne.mockResolvedValue(user());
        expect(await failureBody('admin@acepay.dev', 'wrong-password')).toEqual(expected);
      });

      it('rejects an empty password', async () => {
        users.findOne.mockResolvedValue(user());
        expect(await failureBody('admin@acepay.dev', '')).toEqual(expected);
      });

      it('rejects a user whose stored hash is malformed (not a scrypt string)', async () => {
        users.findOne.mockResolvedValue(user({ passwordHash: 'bcrypt$nonsense' }));
        expect(await failureBody('admin@acepay.dev', PASSWORD)).toEqual(expected);
      });

      it('does not stamp lastLoginAt on a failed attempt', async () => {
        users.findOne.mockResolvedValue(user());
        await failureBody('admin@acepay.dev', 'wrong-password');
        expect(users.save).not.toHaveBeenCalled();
      });

      it('never verifies a password for a deactivated admin', async () => {
        users.findOne.mockResolvedValue(user({ isActive: false }));
        await failureBody('admin@acepay.dev', PASSWORD);
        expect(users.save).not.toHaveBeenCalled();
      });
    });
  });

  describe('issueToken', () => {
    it('carries the user id and email as claims', () => {
      const c = claims(service.issueToken(user()));
      expect(c.sub).toBe('u-1');
      expect(c.email).toBe('admin@acepay.dev');
    });

    it('defaults to a 12-hour TTL when ADMIN_JWT_TTL_HOURS is unset', () => {
      const c = claims(service.issueToken(user()));
      expect(c.exp - c.iat).toBe(12 * 3600);
    });

    it('honours ADMIN_JWT_TTL_HOURS', () => {
      env.ADMIN_JWT_TTL_HOURS = '1';
      const c = claims(service.issueToken(user()));
      expect(c.exp - c.iat).toBe(3600);
    });

    // Number('') is 0 and Number('twelve') is NaN, and `??` only defaults on
    // null/undefined. A 0 TTL mints an already-expired token (every admin
    // locked out); a NaN exp serializes to null, which verifyJwt's
    // `typeof exp === 'number'` check skips — i.e. a token that never expires.
    // Anything unusable must fall back to the documented 12-hour default.
    it.each([
      ['an empty string', ''],
      ['whitespace only', '   '],
      ['a non-numeric value', 'twelve'],
      ['zero', '0'],
      ['negative', '-5'],
      ['Infinity', 'Infinity'],
    ])('falls back to the 12-hour default when the TTL env var is %s', (_label, value) => {
      env.ADMIN_JWT_TTL_HOURS = value;
      const c = claims(service.issueToken(user()));
      expect(c.exp - c.iat).toBe(12 * 3600);
    });

    it('issues a token that actually verifies for every TTL env value', () => {
      for (const value of ['', '   ', 'twelve', '0', '-5', 'Infinity', '1']) {
        env.ADMIN_JWT_TTL_HOURS = value;
        const token = service.issueToken(user());
        expect(service.verifyToken(token)).not.toBeNull();
      }
    });

    it('accepts a fractional TTL', () => {
      env.ADMIN_JWT_TTL_HOURS = '0.5';
      const c = claims(service.issueToken(user()));
      expect(c.exp - c.iat).toBe(1800);
    });

    it('throws a clear error when ADMIN_JWT_SECRET is missing', () => {
      delete env.ADMIN_JWT_SECRET;
      expect(() => service.issueToken(user())).toThrow('ADMIN_JWT_SECRET env var is required');
    });
  });

  describe('verifyToken', () => {
    it('round-trips a token it just issued', () => {
      const payload = service.verifyToken(service.issueToken(user()));
      expect(payload?.sub).toBe('u-1');
    });

    it.each([
      ['a structurally invalid token', 'not-a-jwt'],
      ['an empty string', ''],
      ['a token with too few segments', 'a.b'],
    ])('returns null for %s', (_label, token) => {
      expect(service.verifyToken(token)).toBeNull();
    });

    it('returns null for a token signed with a different secret', () => {
      const token = service.issueToken(user());
      env.ADMIN_JWT_SECRET = 'a-different-secret';
      expect(service.verifyToken(token)).toBeNull();
    });

    it('throws rather than accepting anything when the secret is missing', () => {
      const token = service.issueToken(user());
      delete env.ADMIN_JWT_SECRET;
      expect(() => service.verifyToken(token)).toThrow('ADMIN_JWT_SECRET env var is required');
    });
  });
});
