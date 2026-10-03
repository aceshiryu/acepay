import { classifyApiKey, isApiKeyValid, KeyMatchable } from './api-key-match';

const NOW = new Date('2026-06-01T00:00:00Z');
const FUTURE = new Date('2026-07-01T00:00:00Z');
const PAST = new Date('2026-05-01T00:00:00Z');

function app(overrides: Partial<KeyMatchable> = {}): KeyMatchable {
  return { apiKeyHash: 'hash_current', ...overrides };
}

describe('classifyApiKey (B4)', () => {
  it('matches the current key with no expiry', () => {
    expect(classifyApiKey(app(), 'hash_current', NOW)).toBe('current');
  });

  it('matches the current key before its expiry', () => {
    expect(classifyApiKey(app({ apiKeyExpiresAt: FUTURE }), 'hash_current', NOW)).toBe('current');
  });

  it('rejects the current key after its expiry', () => {
    expect(classifyApiKey(app({ apiKeyExpiresAt: PAST }), 'hash_current', NOW)).toBe('expired');
  });

  it('accepts a previous key within the rotation grace window', () => {
    const a = app({ apiKeyPreviousHash: 'hash_old', apiKeyPreviousExpiresAt: FUTURE });
    expect(classifyApiKey(a, 'hash_old', NOW)).toBe('previous');
  });

  it('rejects a previous key once the grace window has passed', () => {
    const a = app({ apiKeyPreviousHash: 'hash_old', apiKeyPreviousExpiresAt: PAST });
    expect(classifyApiKey(a, 'hash_old', NOW)).toBe('expired');
  });

  it('treats a previous key with no grace expiry as retired', () => {
    const a = app({ apiKeyPreviousHash: 'hash_old', apiKeyPreviousExpiresAt: null });
    expect(classifyApiKey(a, 'hash_old', NOW)).toBe('expired');
  });

  it('returns null when nothing matches', () => {
    expect(classifyApiKey(app(), 'hash_unknown', NOW)).toBeNull();
  });

  it('parses string timestamps (as they come back from the DB)', () => {
    expect(classifyApiKey(app({ apiKeyExpiresAt: '2026-07-01T00:00:00Z' }), 'hash_current', NOW)).toBe('current');
  });

  describe('isApiKeyValid', () => {
    it('is true for current and in-grace previous, false otherwise', () => {
      expect(isApiKeyValid(app(), 'hash_current', NOW)).toBe(true);
      expect(isApiKeyValid(app({ apiKeyPreviousHash: 'old', apiKeyPreviousExpiresAt: FUTURE }), 'old', NOW)).toBe(true);
      expect(isApiKeyValid(app({ apiKeyExpiresAt: PAST }), 'hash_current', NOW)).toBe(false);
      expect(isApiKeyValid(app(), 'nope', NOW)).toBe(false);
    });
  });
});
