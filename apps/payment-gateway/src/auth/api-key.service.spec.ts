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

import { Repository } from 'typeorm';
import { apiKeyPrefix, sha256 } from '../common/crypto';
import { App } from '../database/entities';
import { ApiKeyService } from './api-key.service';

const RAW_CURRENT = 'pk_live_savi_currentkeymaterial000';
const RAW_PREVIOUS = 'pk_live_savi_previouskeymaterial0';
const RAW_UNKNOWN = 'pk_live_savi_nothingmatchesthis00';

const FUTURE = new Date(Date.now() + 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

function app(overrides: Partial<App> = {}): App {
  return {
    id: 'app-1',
    slug: 'savi',
    apiKeyPrefix: apiKeyPrefix(RAW_CURRENT),
    apiKeyHash: sha256(RAW_CURRENT),
    ...overrides,
  } as App;
}

describe('ApiKeyService.resolveByApiKey', () => {
  let apps: { find: jest.Mock };
  let service: ApiKeyService;

  beforeEach(() => {
    apps = { find: jest.fn().mockResolvedValue([]) };
    service = new ApiKeyService(apps as unknown as Repository<App>);
  });

  describe('lookup', () => {
    it('searches on both the current and the previous key prefix', async () => {
      await service.resolveByApiKey(RAW_CURRENT);
      const prefix = apiKeyPrefix(RAW_CURRENT);
      expect(apps.find).toHaveBeenCalledWith({
        where: [{ apiKeyPrefix: prefix }, { apiKeyPreviousPrefix: prefix }],
      });
    });

    it('queries by prefix only — the raw key never reaches the database', async () => {
      await service.resolveByApiKey(RAW_CURRENT);
      const query = JSON.stringify(apps.find.mock.calls[0][0]);
      expect(query).not.toContain(RAW_CURRENT);
      expect(query).not.toContain(sha256(RAW_CURRENT));
    });

    it('returns null when no app carries that prefix', async () => {
      apps.find.mockResolvedValue([]);
      await expect(service.resolveByApiKey(RAW_UNKNOWN)).resolves.toBeNull();
    });
  });

  describe('accepting a key', () => {
    it('resolves an app by its current key', async () => {
      const a = app();
      apps.find.mockResolvedValue([a]);
      await expect(service.resolveByApiKey(RAW_CURRENT)).resolves.toBe(a);
    });

    it('resolves an app by its current key while an expiry is still in the future', async () => {
      const a = app({ apiKeyExpiresAt: FUTURE });
      apps.find.mockResolvedValue([a]);
      await expect(service.resolveByApiKey(RAW_CURRENT)).resolves.toBe(a);
    });

    it('resolves an app by a previous key inside the rotation grace window', async () => {
      const a = app({
        apiKeyPreviousPrefix: apiKeyPrefix(RAW_PREVIOUS),
        apiKeyPreviousHash: sha256(RAW_PREVIOUS),
        apiKeyPreviousExpiresAt: FUTURE,
      });
      apps.find.mockResolvedValue([a]);
      await expect(service.resolveByApiKey(RAW_PREVIOUS)).resolves.toBe(a);
    });
  });

  describe('rejecting a key', () => {
    it('rejects a key whose hash does not match, even when the prefix does', async () => {
      // Same 16-char prefix, different secret material.
      apps.find.mockResolvedValue([app()]);
      await expect(service.resolveByApiKey('pk_live_savi_someoneelseskey00000')).resolves.toBeNull();
    });

    it('rejects an expired current key', async () => {
      apps.find.mockResolvedValue([app({ apiKeyExpiresAt: PAST })]);
      await expect(service.resolveByApiKey(RAW_CURRENT)).resolves.toBeNull();
    });

    it('rejects a previous key whose grace window has closed', async () => {
      apps.find.mockResolvedValue([app({
        apiKeyPreviousPrefix: apiKeyPrefix(RAW_PREVIOUS),
        apiKeyPreviousHash: sha256(RAW_PREVIOUS),
        apiKeyPreviousExpiresAt: PAST,
      })]);
      await expect(service.resolveByApiKey(RAW_PREVIOUS)).resolves.toBeNull();
    });

    it('rejects a previous key that has no grace expiry set (already retired)', async () => {
      apps.find.mockResolvedValue([app({
        apiKeyPreviousPrefix: apiKeyPrefix(RAW_PREVIOUS),
        apiKeyPreviousHash: sha256(RAW_PREVIOUS),
        apiKeyPreviousExpiresAt: null,
      })]);
      await expect(service.resolveByApiKey(RAW_PREVIOUS)).resolves.toBeNull();
    });

    it.each([
      ['an empty key', ''],
      ['a whitespace key', '   '],
      ['a short garbage key', 'nope'],
    ])('rejects %s', async (_label, key) => {
      apps.find.mockResolvedValue([app()]);
      await expect(service.resolveByApiKey(key)).resolves.toBeNull();
    });
  });

  // Only 16 chars of the key are stored as the lookup prefix, so two apps can
  // legitimately come back from one query — the loop must keep looking instead
  // of accepting or rejecting on the first row.
  describe('prefix collisions between apps', () => {
    it('skips a matching-but-expired app and accepts a later valid one', async () => {
      const expired = app({ id: 'app-expired', apiKeyExpiresAt: PAST });
      const valid = app({ id: 'app-valid' });
      apps.find.mockResolvedValue([expired, valid]);
      const resolved = await service.resolveByApiKey(RAW_CURRENT);
      expect(resolved?.id).toBe('app-valid');
    });

    it('skips a non-matching app and accepts the one that matches', async () => {
      const other = app({ id: 'app-other', apiKeyHash: sha256('pk_live_savi_someotherapp0000000') });
      const valid = app({ id: 'app-valid' });
      apps.find.mockResolvedValue([other, valid]);
      const resolved = await service.resolveByApiKey(RAW_CURRENT);
      expect(resolved?.id).toBe('app-valid');
    });

    it('returns null when every colliding app is expired', async () => {
      apps.find.mockResolvedValue([
        app({ id: 'a', apiKeyExpiresAt: PAST }),
        app({ id: 'b', apiKeyExpiresAt: PAST }),
      ]);
      await expect(service.resolveByApiKey(RAW_CURRENT)).resolves.toBeNull();
    });

    it('does not let an expired row shadow a valid previous-key row', async () => {
      const expired = app({ id: 'app-expired', apiKeyExpiresAt: PAST });
      const rotating = app({
        id: 'app-rotating',
        apiKeyHash: sha256('pk_live_savi_brandnewkey000000000'),
        apiKeyPreviousPrefix: apiKeyPrefix(RAW_CURRENT),
        apiKeyPreviousHash: sha256(RAW_CURRENT),
        apiKeyPreviousExpiresAt: FUTURE,
      });
      apps.find.mockResolvedValue([expired, rotating]);
      const resolved = await service.resolveByApiKey(RAW_CURRENT);
      expect(resolved?.id).toBe('app-rotating');
    });
  });

  // resolveByApiKey answers "which app is this", not "is it allowed" — the
  // ApiKeyGuard owns the isActive check, so an inactive app must still resolve
  // or the guard could never tell "unknown key" from "deactivated app".
  it('resolves an inactive app and leaves the isActive decision to the guard', async () => {
    const a = app({ isActive: false });
    apps.find.mockResolvedValue([a]);
    await expect(service.resolveByApiKey(RAW_CURRENT)).resolves.toBe(a);
  });
});
