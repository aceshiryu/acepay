import {
  apiKeyPrefix,
  decryptSecret,
  encryptSecret,
  generateApiKey,
  generateWebhookSecret,
  hashPassword,
  hmacSha256,
  sha256,
  signJwt,
  timingSafeEqualHex,
  verifyJwt,
  verifyPassword,
} from './crypto';

// A 32-byte key in hex (64 hex chars) for AES-256-GCM.
const HEX_KEY = 'a'.repeat(64);

describe('crypto helpers', () => {
  describe('sha256', () => {
    it('produces the known digest for a fixed input', () => {
      // Well-known SHA-256 of "abc".
      expect(sha256('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    it('is deterministic and differs for different inputs', () => {
      expect(sha256('hello')).toBe(sha256('hello'));
      expect(sha256('hello')).not.toBe(sha256('hellp'));
    });
  });

  describe('hmacSha256', () => {
    it('is stable for the same secret+body', () => {
      const a = hmacSha256('secret', 'payload');
      const b = hmacSha256('secret', 'payload');
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('changes when the secret changes', () => {
      expect(hmacSha256('secret-1', 'payload')).not.toBe(hmacSha256('secret-2', 'payload'));
    });

    it('changes when the body changes', () => {
      expect(hmacSha256('secret', 'a')).not.toBe(hmacSha256('secret', 'b'));
    });
  });

  describe('timingSafeEqualHex', () => {
    it('returns true for identical hex strings', () => {
      const h = hmacSha256('s', 'b');
      expect(timingSafeEqualHex(h, h)).toBe(true);
    });

    it('returns false for different-length strings without throwing', () => {
      expect(timingSafeEqualHex('aa', 'aabb')).toBe(false);
    });

    it('returns false for equal-length but different strings', () => {
      expect(timingSafeEqualHex('aabb', 'aabc')).toBe(false);
    });

    it('does not throw on non-hex input', () => {
      // Node's hex decoder drops invalid nibbles; equal-length garbage decodes
      // to equal (empty) buffers. The helper must never throw regardless.
      expect(() => timingSafeEqualHex('zzzz', 'zzzz')).not.toThrow();
      expect(timingSafeEqualHex('zz', 'aabb')).toBe(false);
    });
  });

  describe('generateApiKey / prefix', () => {
    it('encodes mode + slug and is unique per call', () => {
      const a = generateApiKey('savi', 'live');
      const b = generateApiKey('savi', 'live');
      expect(a).toMatch(/^pk_live_savi_/);
      expect(a).not.toBe(b);
    });

    it('defaults to live mode and supports test mode', () => {
      expect(generateApiKey('savi')).toMatch(/^pk_live_/);
      expect(generateApiKey('savi', 'test')).toMatch(/^pk_test_/);
    });

    it('apiKeyPrefix returns the first 16 chars', () => {
      const key = generateApiKey('savi', 'live');
      expect(apiKeyPrefix(key)).toBe(key.slice(0, 16));
      expect(apiKeyPrefix(key)).toHaveLength(16);
    });
  });

  describe('generateWebhookSecret', () => {
    it('is prefixed and unique', () => {
      const a = generateWebhookSecret();
      const b = generateWebhookSecret();
      expect(a).toMatch(/^whsec_/);
      expect(a).not.toBe(b);
    });
  });

  describe('AES-256-GCM encryptSecret/decryptSecret', () => {
    const prev = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    beforeAll(() => {
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = HEX_KEY;
    });
    afterAll(() => {
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = prev;
    });

    it('round-trips a secret', () => {
      const secret = 'whsec_super_secret_value';
      expect(decryptSecret(encryptSecret(secret))).toBe(secret);
    });

    it('produces different ciphertext each time (random IV)', () => {
      const secret = 'same-input';
      expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
    });

    it('accepts a base64-encoded 32-byte key too', () => {
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
      const secret = 'via-base64-key';
      expect(decryptSecret(encryptSecret(secret))).toBe(secret);
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = HEX_KEY;
    });

    it('throws when the key is missing', () => {
      delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
      expect(() => encryptSecret('x')).toThrow(/WEBHOOK_SECRET_ENCRYPTION_KEY/);
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = HEX_KEY;
    });

    it('throws when the key is the wrong length', () => {
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = 'deadbeef';
      expect(() => encryptSecret('x')).toThrow(/32 bytes/);
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = HEX_KEY;
    });

    it('fails to decrypt if the ciphertext is tampered', () => {
      const enc = encryptSecret('tamper-me');
      const buf = Buffer.from(enc, 'base64');
      buf[buf.length - 1] ^= 0xff; // flip a byte in the ciphertext
      expect(() => decryptSecret(buf.toString('base64'))).toThrow();
    });
  });

  describe('password hashing (scrypt)', () => {
    it('verifies a correct password', async () => {
      const stored = await hashPassword('correct horse battery staple');
      expect(stored).toMatch(/^scrypt\$/);
      await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true);
    });

    it('rejects a wrong password', async () => {
      const stored = await hashPassword('right');
      await expect(verifyPassword('wrong', stored)).resolves.toBe(false);
    });

    it('produces a different hash each time (random salt)', async () => {
      const a = await hashPassword('same');
      const b = await hashPassword('same');
      expect(a).not.toBe(b);
    });

    it('returns false for a malformed stored value', async () => {
      await expect(verifyPassword('x', 'not-a-valid-hash')).resolves.toBe(false);
      await expect(verifyPassword('x', 'bcrypt$foo$bar$baz')).resolves.toBe(false);
    });
  });

  describe('JWT sign/verify', () => {
    const SECRET = 'jwt-signing-secret';

    it('signs and verifies a payload round-trip', () => {
      const token = signJwt({ sub: 'user-1', role: 'admin' }, SECRET, 3600);
      const decoded = verifyJwt<{ sub: string; role: string; exp: number; iat: number }>(token, SECRET);
      expect(decoded).not.toBeNull();
      expect(decoded?.sub).toBe('user-1');
      expect(decoded?.role).toBe('admin');
      expect(decoded?.exp).toBeGreaterThan(decoded!.iat);
    });

    it('rejects a token signed with a different secret', () => {
      const token = signJwt({ sub: 'user-1' }, SECRET, 3600);
      expect(verifyJwt(token, 'other-secret')).toBeNull();
    });

    it('rejects a tampered payload', () => {
      const token = signJwt({ sub: 'user-1', role: 'user' }, SECRET, 3600);
      const [h, , s] = token.split('.');
      const forged = Buffer.from(JSON.stringify({ sub: 'user-1', role: 'admin' })).toString('base64url');
      expect(verifyJwt(`${h}.${forged}.${s}`, SECRET)).toBeNull();
    });

    it('rejects an expired token', () => {
      const token = signJwt({ sub: 'user-1' }, SECRET, -1); // already expired
      expect(verifyJwt(token, SECRET)).toBeNull();
    });

    it('rejects a structurally invalid token', () => {
      expect(verifyJwt('not.a.jwt.token', SECRET)).toBeNull();
      expect(verifyJwt('only-one-part', SECRET)).toBeNull();
    });
  });
});
